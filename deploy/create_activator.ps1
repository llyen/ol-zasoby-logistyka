<#
.SYNOPSIS
    Tworzy Activator scenariusza logistycznego i wdraza reguly alertowe jako funkcje KQL.

.DESCRIPTION
    Skrypt jest idempotentny:
      - wyszukuje albo tworzy element Reflex/Activator OL_LOG_Activator,
      - tworzy/aktualizuje funkcje KQL alert_* w Eventhouse wg activator\RULES.md,
      - weryfikuje liczbe trafien i wypisuje przykladowe rekordy.

    Wszystkie funkcje zwracaja ten sam zestaw kolumn kontraktowych
    (alert_rule, alert_severity, alert_ts, alert_key, current_value, threshold_value,
    spo, message), dzieki czemu Activator albo KQL alert moze je obsluzyc jednym
    szablonem powiadomienia, niezaleznie od reguly.

    Powiadomienia Activatora dokancza sie w UI - publiczne API Fabric nie wystawia
    jeszcze definicji regul powiadomien.

.EXAMPLE
    .\deploy\create_activator.ps1 -WorkspaceName OL-ZK-Demo-Zasoby
#>
[CmdletBinding()]
param(
    [string]$WorkspaceName = 'OL-ZK-Demo-Zasoby',
    [string]$ActivatorName = 'OL_LOG_Activator',
    [string]$WorkspaceId = 'aebf1df2-3be8-4f89-9d8d-647ae519d50b',
    [string]$ClusterUri = 'https://trd-1mgsz6pz0kcbxjcnjw.z9.kusto.fabric.microsoft.com',
    [string]$KqlDatabaseName = 'OL_LOG_Eventhouse'
)

$ErrorActionPreference = 'Stop'
$FabricApi = 'https://api.fabric.microsoft.com/v1'

function Write-Step($msg) { Write-Host "`n=== $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "  $msg" -ForegroundColor Gray }
function Write-Warn($msg) { Write-Host "  [UWAGA] $msg" -ForegroundColor Yellow }

function Get-Token([string]$resource) {
    az account get-access-token --resource $resource --query accessToken -o tsv
}

function Get-FabricHeaders {
    @{ Authorization = "Bearer $(Get-Token 'https://api.fabric.microsoft.com')"; 'Content-Type' = 'application/json' }
}

function Get-KustoHeaders {
    @{ Authorization = "Bearer $(Get-Token 'https://kusto.kusto.windows.net')"; 'Content-Type' = 'application/json' }
}

function Resolve-Workspace {
    $ws = (Invoke-RestMethod -Uri "$FabricApi/workspaces" -Headers (Get-FabricHeaders)).value |
          Where-Object displayName -eq $WorkspaceName | Select-Object -First 1
    if ($ws) { return $ws.id }
    if ($WorkspaceId) {
        Write-Warn "Nie znaleziono workspace '$WorkspaceName' po nazwie; uzywam id $WorkspaceId."
        return $WorkspaceId
    }
    throw "Nie znaleziono workspace '$WorkspaceName'."
}

function Invoke-FabricWebRequest([string]$method, [string]$uri, $body = $null) {
    $json = if ($null -ne $body) { $body | ConvertTo-Json -Depth 100 } else { $null }
    $response = Invoke-WebRequest -Method $method -Uri $uri -Headers (Get-FabricHeaders) -Body $json -ContentType 'application/json' -SkipHttpErrorCheck
    if ($response.StatusCode -eq 202) {
        $operationUrl = $response.Headers.Location | Select-Object -First 1
        if ($operationUrl) {
            do {
                Start-Sleep -Seconds 5
                $operation = Invoke-RestMethod -Method Get -Uri $operationUrl -Headers (Get-FabricHeaders)
                Write-Info "operacja Fabric: $($operation.status)"
            } while ($operation.status -in 'NotStarted', 'Running')
            if ($operation.status -notin 'Succeeded', 'Completed') {
                throw "Operacja Fabric nie powiodla sie: $($operation | ConvertTo-Json -Depth 20)"
            }
        }
    }
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
        throw "Fabric REST $method $uri zwrocil $($response.StatusCode): $($response.Content)"
    }
    return $response
}

function Get-OrCreateActivator([string]$workspaceId) {
    $item = (Invoke-RestMethod -Uri "$FabricApi/workspaces/$workspaceId/items" -Headers (Get-FabricHeaders)).value |
            Where-Object { $_.displayName -eq $ActivatorName -and $_.type -eq 'Reflex' } |
            Select-Object -First 1
    if ($item) { Write-Ok "Activator juz istnieje: $($item.id)"; return $item }

    $response = Invoke-FabricWebRequest -method Post -uri "$FabricApi/workspaces/$workspaceId/reflexes" -body @{
        displayName = $ActivatorName
        description = 'Reguly alertowe logistyki zasobow wg activator\RULES.md'
    }
    $created = $response.Content | ConvertFrom-Json
    Write-Ok "utworzono Activator: $($created.id)"
    return $created
}

function Invoke-KustoMgmt([string]$command) {
    $body = @{ db = $KqlDatabaseName; csl = $command } | ConvertTo-Json -Depth 20
    Invoke-RestMethod -Method Post -Uri "$ClusterUri/v1/rest/mgmt" -Headers (Get-KustoHeaders) -Body $body | Out-Null
}

function Invoke-KustoQuery([string]$query) {
    $body = @{ db = $KqlDatabaseName; csl = $query } | ConvertTo-Json -Depth 20
    $response = Invoke-RestMethod -Method Post -Uri "$ClusterUri/v2/rest/query" -Headers (Get-KustoHeaders) -Body $body
    $response | Where-Object TableKind -eq 'PrimaryResult'
}

# Progi sa zgodne z activator\RULES.md. Kazda funkcja zwraca kolumny kontraktowe,
# zeby powiadomienie i lista alertow mialy jeden format niezaleznie od reguly.
$FunctionCommands = @'
.create-or-alter function with (folder='Activator/Logistyka', docstring='Alert: transport opozniony ponad 30 minut. Alert powstaje w chwili wystapienia opoznienia, wiec patrzymy na odczyty z ostatnich 30 minut, a nie na koncowy status transportu - ten po dostarczeniu zawsze wraca do delivered.') alert_transport_delayed() {
TransportTracking
| where timestamp > ago(30m)
| where delay_min > 30 and status != 'delivered'
| summarize arg_max(timestamp, lat, lon, speed_kmh, status, delay_min, allocation_id) by transport_id
| extend alert_rule='alert_transport_delayed', alert_severity=iff(delay_min > 60, 'critical', 'warning'), alert_ts=timestamp, alert_key=strcat(transport_id, ':', format_datetime(bin(timestamp, 1h), 'yyyy-MM-dd HH:mm')), current_value=todouble(delay_min), threshold_value=30.0, spo='SPO-12', message=strcat('TRANSPORT OPOZNIONY - ', transport_id, ', ', tostring(delay_min), ' min ponad plan, status ', status)
| project alert_rule, alert_severity, alert_ts, alert_key, current_value, threshold_value, spo, message, transport_id, allocation_id, lat, lon, speed_kmh, status
}
---NEXT---
.create-or-alter function with (folder='Activator/Logistyka', docstring='Alert: punkt przyjecia powyzej 90 procent pojemnosci') alert_shelter_overload() {
ShelterOccupancy
| summarize arg_max(timestamp, capacity, occupied, medical_care_required) by shelter_id
| where capacity > 0
| extend occupancy_pct = round(100.0 * occupied / capacity, 1)
| where occupancy_pct > 90
| lookup kind=leftouter (dim_shelter | project shelter_id, shelter_name, gmina_code) on shelter_id
| extend alert_rule='alert_shelter_overload', alert_severity=iff(occupancy_pct >= 100, 'critical', 'warning'), alert_ts=timestamp, alert_key=strcat(shelter_id, ':', format_datetime(bin(timestamp, 1h), 'yyyy-MM-dd HH:mm')), current_value=occupancy_pct, threshold_value=90.0, spo='SPO-12', message=strcat('PUNKT PRZEPELNIONY - ', shelter_name, ', ', tostring(occupied), '/', tostring(capacity), ' miejsc (', tostring(occupancy_pct), '%)')
| project alert_rule, alert_severity, alert_ts, alert_key, current_value, threshold_value, spo, message, shelter_id, shelter_name, gmina_code, occupied, capacity, medical_care_required
}
---NEXT---
.create-or-alter function with (folder='Activator/Logistyka', docstring='Alert: zapas zasobu ponizej 2 dni przy biezacym zuzyciu') alert_stock_depletion() {
let zuzycie_dobowe = Consumption
    | summarize dzienne = sum(consumed_qty) by voivodeship_code, resource_type_id, dzien = startofday(timestamp)
    | summarize daily_consumption = round(avg(dzienne), 1) by voivodeship_code, resource_type_id;
StockSnapshot
| summarize arg_max(snapshot_date, available_qty) by warehouse_id, resource_type_id
| lookup kind=inner (dim_warehouse | project warehouse_id, voivodeship_code) on warehouse_id
| summarize available_qty = sum(available_qty), alert_ts = max(snapshot_date) by voivodeship_code, resource_type_id
| join kind=inner zuzycie_dobowe on voivodeship_code, resource_type_id
| where daily_consumption > 0
| extend days_of_stock = round(todouble(available_qty) / daily_consumption, 2)
| where days_of_stock < 2
| lookup kind=leftouter (dim_resource_type | project resource_type_id, resource_name, unit) on resource_type_id
| lookup kind=leftouter (dim_voivodeship | project voivodeship_code, voivodeship_name) on voivodeship_code
| extend alert_rule='alert_stock_depletion', alert_severity=iff(days_of_stock < 1, 'critical', 'warning'), alert_key=strcat(voivodeship_code, ':', resource_type_id), current_value=days_of_stock, threshold_value=2.0, spo='SPO-2', message=strcat('ZAPAS KRYTYCZNY - ', resource_name, ' w woj. ', voivodeship_name, ': ', tostring(days_of_stock), ' dnia zapasu przy zuzyciu ', tostring(daily_consumption), ' ', unit, '/dobe')
| project alert_rule, alert_severity, alert_ts, alert_key, current_value, threshold_value, spo, message, voivodeship_code, voivodeship_name, resource_type_id, resource_name, available_qty, daily_consumption, days_of_stock
| order by current_value asc
}
---NEXT---
.create-or-alter function with (folder='Activator/Logistyka', docstring='Alert: zapotrzebowanie priorytetu 1 nieobsluzone. Prog produkcyjny z RULES.md: 2 h. Prog demo: 2 min zegara, bo scenariusz biegnie w tempie 60x i 2 h akcji trwa 2 minuty.') alert_priority1_unserved() {
Demand
| where priority == 1
| where timestamp < ago(2m)
| join kind=leftouter (Allocation | project demand_id, allocation_id, allocation_status = status) on demand_id
| where isempty(allocation_id) or allocation_status !in ('accepted', 'in_transit', 'delivered')
| lookup kind=leftouter (dim_gmina | project gmina_code, gmina_name) on gmina_code
| lookup kind=leftouter (dim_resource_type | project resource_type_id, resource_name) on resource_type_id
| extend czeka_h = round((now() - timestamp) / 1h * 60, 1)
| extend alert_rule='alert_priority1_unserved', alert_severity='critical', alert_ts=timestamp, alert_key=demand_id, current_value=czeka_h, threshold_value=2.0, spo='SPO-12', message=strcat('PRIORYTET 1 BEZ OBSLUGI - ', demand_id, ', ', resource_name, ' dla gminy ', gmina_name, ', czeka ', tostring(czeka_h), ' h')
| project alert_rule, alert_severity, alert_ts, alert_key, current_value, threshold_value, spo, message, demand_id, gmina_code, gmina_name, resource_type_id, resource_name, quantity, justification
| order by current_value desc
}
---NEXT---
.create-or-alter function with (folder='Activator/Logistyka', docstring='Alert: odcinek drogi nieprzejezdny') alert_road_blocked() {
RoadStatus
| summarize arg_max(timestamp, status, reason, lat, lon, road_name, voivodeship_code) by road_segment_id
| where status == 'nieprzejezdna'
| lookup kind=leftouter (dim_voivodeship | project voivodeship_code, voivodeship_name) on voivodeship_code
| extend alert_rule='alert_road_blocked', alert_severity='critical', alert_ts=timestamp, alert_key=strcat(road_segment_id, ':', format_datetime(bin(timestamp, 1h), 'yyyy-MM-dd HH:mm')), current_value=1.0, threshold_value=1.0, spo='SPO-12', message=strcat('DROGA NIEPRZEJEZDNA - ', road_name, ' w woj. ', voivodeship_name, ', przyczyna: ', reason)
| project alert_rule, alert_severity, alert_ts, alert_key, current_value, threshold_value, spo, message, road_segment_id, road_name, voivodeship_code, voivodeship_name, reason, lat, lon
}
---NEXT---
.create-or-alter function with (folder='Activator/Logistyka', docstring='Alert: wniosek SPO-2 powyzej 5 mln PLN bez akceptacji') alert_spo2_limit() {
FinancialRequest
| where amount_pln > 5000000 and status !in ('MF_approved', 'paid')
| lookup kind=leftouter (dim_voivodeship | project voivodeship_code, voivodeship_name) on voivodeship_code
| extend alert_rule='alert_spo2_limit', alert_severity=iff(amount_pln > 10000000, 'critical', 'warning'), alert_ts=timestamp, alert_key=financial_request_id, current_value=todouble(amount_pln), threshold_value=5000000.0, spo='SPO-2', message=strcat('WNIOSEK SPO-2 PONAD LIMIT - ', financial_request_id, ', ', tostring(round(amount_pln / 1000000.0, 1)), ' mln PLN, wnioskodawca ', applicant, ', woj. ', voivodeship_name, ', stan: ', status)
| project alert_rule, alert_severity, alert_ts, alert_key, current_value, threshold_value, spo, message, financial_request_id, applicant, voivodeship_code, voivodeship_name, amount_pln, purpose, status, approval_path
| order by current_value desc
}
---NEXT---
.create-or-alter function with (folder='Activator/Logistyka', docstring='Alert: wzrost zapotrzebowan o ponad 50 procent w 6 godzinach') alert_demand_surge() {
Demand
| summarize zgloszenia = count(), sztuk = sum(quantity) by voivodeship_code, okno = bin(timestamp, 6h)
| order by voivodeship_code asc, okno asc
| serialize
| extend poprzednie = prev(zgloszenia), poprzednie_woj = prev(voivodeship_code)
| where voivodeship_code == poprzednie_woj and poprzednie > 0 and zgloszenia > poprzednie * 1.5
| lookup kind=leftouter (dim_voivodeship | project voivodeship_code, voivodeship_name) on voivodeship_code
| extend wzrost_pct = round(100.0 * (zgloszenia - poprzednie) / poprzednie, 1)
| extend alert_rule='alert_demand_surge', alert_severity='warning', alert_ts=okno, alert_key=strcat(voivodeship_code, ':', format_datetime(okno, 'yyyy-MM-dd HH:mm')), current_value=wzrost_pct, threshold_value=50.0, spo='SPO-2;SPO-12', message=strcat('SKOK ZAPOTRZEBOWAN - woj. ', voivodeship_name, ', ', tostring(zgloszenia), ' zgloszen wobec ', tostring(poprzednie), ' w poprzednim oknie (+', tostring(wzrost_pct), '%)')
| project alert_rule, alert_severity, alert_ts, alert_key, current_value, threshold_value, spo, message, voivodeship_code, voivodeship_name, zgloszenia, poprzednie, sztuk
| order by alert_ts asc
}
'@ -split '---NEXT---'

Write-Step "Workspace: $WorkspaceName"
$ResolvedWorkspaceId = Resolve-Workspace
Write-Ok "workspace id = $ResolvedWorkspaceId"

Write-Step 'Activator'
$Activator = Get-OrCreateActivator -workspaceId $ResolvedWorkspaceId
Write-Info "element Reflex: $($Activator.id)"

Write-Step 'Funkcje KQL alertow'
foreach ($command in $FunctionCommands) {
    Invoke-KustoMgmt $command.Trim()
}
Write-Ok "utworzono/zaktualizowano $($FunctionCommands.Count) funkcji"

Write-Step 'Weryfikacja trafien'
$functions = @(
    'alert_transport_delayed',
    'alert_shelter_overload',
    'alert_stock_depletion',
    'alert_priority1_unserved',
    'alert_road_blocked',
    'alert_spo2_limit',
    'alert_demand_surge'
)
foreach ($functionName in $functions) {
    $metrics = Invoke-KustoQuery "$functionName() | summarize trafienia=count(), klucze=dcount(alert_key), krytyczne=countif(alert_severity == 'critical')"
    $sample = Invoke-KustoQuery "$functionName() | top 1 by current_value desc | project message"
    Write-Host "`n$functionName" -ForegroundColor Yellow
    Write-Host "  liczby : $($metrics.Rows[0] | ConvertTo-Json -Compress)"
    Write-Host "  przyklad: $($sample.Rows[0] | ConvertTo-Json -Compress)"
}

Write-Ok 'Gotowe. Reguly KQL dzialaja; powiadomienia Activator dokoncz w UI wg activator\RULES.md.'
