<#
.SYNOPSIS
    Wdrozenie demo "Rezerwy i Zasoby - Logistyka Kryzysowa" do Microsoft Fabric.

.DESCRIPTION
    Tworzy i konfiguruje elementy Fabric potrzebne do uruchomienia demo:
      - Lakehouse (wymiary i dane referencyjne)
      - Eventhouse / baza KQL (strumienie telemetrii)
      - tabele i mapowania JSON w bazie KQL
      - wgranie plikow danych do OneLake
      - zaladowanie strumieni JSONL do Eventhouse

    Uwierzytelnienie: Azure CLI (`az login`). Skrypt pobiera tokeny dla
    api.fabric.microsoft.com (Fabric REST), storage.azure.com (OneLake)
    oraz kusto.kusto.windows.net (Eventhouse).

.PARAMETER WorkspaceName
    Nazwa workspace w Fabric. Musi istniec albo zostanie utworzona na wskazanej pojemnosci.

.PARAMETER CapacityName
    Nazwa pojemnosci Fabric (uzywana tylko przy tworzeniu nowego workspace).

.PARAMETER Step
    Ktory etap wykonac: all | items | kql | upload | ingest | verify

.EXAMPLE
    .\deploy\deploy_fabric.ps1 -WorkspaceName OL-ZK-Demo-Zasoby -CapacityName fcdemo
#>
[CmdletBinding()]
param(
    [string]$WorkspaceName = 'OL-ZK-Demo-Zasoby',
    [string]$CapacityName  = '',
    [ValidateSet('all', 'items', 'kql', 'upload', 'ingest', 'verify')]
    [string]$Step = 'all'
)

$ErrorActionPreference = 'Stop'
$RepoRoot       = Split-Path -Parent $PSScriptRoot
$LakehouseName  = 'OL_LOG_Lakehouse'
$EventhouseName = 'OL_LOG_Eventhouse'
# D0 sceny "POWODZ WRZESIEN" - data migawki stanow magazynowych
$ScenarioStartDate = '2026-09-15'
$FabricApi      = 'https://api.fabric.microsoft.com/v1'

function Write-Step($msg) { Write-Host "`n=== $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "  $msg" -ForegroundColor Gray }
function Write-Warn($msg) { Write-Host "  [UWAGA] $msg" -ForegroundColor Yellow }

function Get-Token($resource) {
    az account get-access-token --resource $resource --query accessToken -o tsv
}

function Get-FabricHeaders {
    @{ Authorization = "Bearer $(Get-Token 'https://api.fabric.microsoft.com')"; 'Content-Type' = 'application/json' }
}

function Resolve-Workspace {
    $h = Get-FabricHeaders
    $ws = (Invoke-RestMethod -Uri "$FabricApi/workspaces" -Headers $h).value |
          Where-Object displayName -eq $WorkspaceName | Select-Object -First 1
    if ($ws) { return $ws }

    if (-not $CapacityName) { throw "Workspace '$WorkspaceName' nie istnieje. Podaj -CapacityName, aby go utworzyc." }
    $cap = (Invoke-RestMethod -Uri "$FabricApi/capacities" -Headers $h).value |
           Where-Object displayName -eq $CapacityName | Select-Object -First 1
    if (-not $cap) { throw "Nie znaleziono pojemnosci '$CapacityName'." }

    $body = @{ displayName = $WorkspaceName; capacityId = $cap.id } | ConvertTo-Json
    Invoke-RestMethod -Uri "$FabricApi/workspaces" -Headers $h -Method Post -Body $body
}

function New-FabricItem($workspaceId, $type, $name) {
    $h = Get-FabricHeaders
    $existing = (Invoke-RestMethod -Uri "$FabricApi/workspaces/$workspaceId/items" -Headers $h).value |
                Where-Object { $_.displayName -eq $name -and $_.type -eq $type } | Select-Object -First 1
    if ($existing) { Write-Info "$type '$name' juz istnieje"; return $existing }

    $body = @{ displayName = $name; type = $type } | ConvertTo-Json
    $r = Invoke-WebRequest -Uri "$FabricApi/workspaces/$workspaceId/items" -Headers $h -Method Post -Body $body
    if ($r.StatusCode -eq 202) {
        $op = $r.Headers.Location | Select-Object -First 1
        do {
            Start-Sleep 5
            $st = Invoke-RestMethod -Uri $op -Headers (Get-FabricHeaders)
        } while ($st.status -in 'Running', 'NotStarted')
    }
    $created = (Invoke-RestMethod -Uri "$FabricApi/workspaces/$workspaceId/items" -Headers (Get-FabricHeaders)).value |
               Where-Object { $_.displayName -eq $name -and $_.type -eq $type } | Select-Object -First 1
    Write-Ok "utworzono $type '$name'"
    return $created
}

function Invoke-KustoMgmt($clusterUri, $database, $command) {
    $h = @{ Authorization = "Bearer $(Get-Token 'https://kusto.kusto.windows.net')"; 'Content-Type' = 'application/json' }
    $body = @{ db = $database; csl = $command } | ConvertTo-Json -Depth 3
    Invoke-RestMethod -Uri "$clusterUri/v1/rest/mgmt" -Headers $h -Method Post -Body $body
}

function Invoke-KustoQuery($clusterUri, $database, $query) {
    $h = @{ Authorization = "Bearer $(Get-Token 'https://kusto.kusto.windows.net')"; 'Content-Type' = 'application/json' }
    $body = @{ db = $database; csl = $query } | ConvertTo-Json -Depth 3
    Invoke-RestMethod -Uri "$clusterUri/v1/rest/query" -Headers $h -Method Post -Body $body
}

# Dzieli plik .kql na pojedyncze komendy sterujace (kazda zaczyna sie od kropki).
function Split-KqlCommands($path) {
    $commands = @()
    $current = ''
    foreach ($line in (Get-Content $path)) {
        if ($line -match '^\s*//' -or $line.Trim() -eq '') { continue }
        if ($line -match '^\s*\.' -and $current.Trim()) { $commands += $current; $current = $line }
        else { if ($current) { $current += "`n$line" } else { $current = $line } }
    }
    if ($current.Trim()) { $commands += $current }
    return $commands
}

function Send-ToOneLake($workspaceId, $lakehouseId, $localPath, $relativePath) {
    $token = Get-Token 'https://storage.azure.com'
    $h = @{ Authorization = "Bearer $token"; 'x-ms-version' = '2021-06-08' }
    $url = "https://onelake.dfs.fabric.microsoft.com/$workspaceId/$lakehouseId/Files/$relativePath"

    Invoke-RestMethod -Uri "${url}?resource=file" -Headers $h -Method Put | Out-Null

    # Duze pliki wysylamy porcjami - pojedynczy append ma limit po stronie uslugi.
    $chunkSize = 8MB
    $stream = [System.IO.File]::OpenRead($localPath)
    try {
        $buffer = New-Object byte[] $chunkSize
        $position = 0L
        $hAppend = $h.Clone(); $hAppend['Content-Type'] = 'application/octet-stream'
        while (($read = $stream.Read($buffer, 0, $chunkSize)) -gt 0) {
            $chunk = New-Object byte[] $read
            [Array]::Copy($buffer, 0, $chunk, 0, $read)
            Invoke-RestMethod -Uri "${url}?action=append&position=$position" -Headers $hAppend -Method Patch -Body $chunk | Out-Null
            $position += $read
        }
        Invoke-RestMethod -Uri "${url}?action=flush&position=$position" -Headers $h -Method Patch | Out-Null
    } finally { $stream.Dispose() }
    Write-Ok "$relativePath ($([math]::Round($position / 1MB, 1)) MB)"
}

# =========================================================================
Write-Step "Workspace: $WorkspaceName"
$ws = Resolve-Workspace
Write-Ok "workspace id = $($ws.id)"

Write-Step 'Elementy workspace'
$lakehouse  = New-FabricItem $ws.id 'Lakehouse'  $LakehouseName
$eventhouse = New-FabricItem $ws.id 'Eventhouse' $EventhouseName

$h = Get-FabricHeaders
$ehDetail   = Invoke-RestMethod -Uri "$FabricApi/workspaces/$($ws.id)/eventhouses/$($eventhouse.id)" -Headers $h
$clusterUri = $ehDetail.properties.queryServiceUri
$kqlDbName  = ((Invoke-RestMethod -Uri "$FabricApi/workspaces/$($ws.id)/kqlDatabases" -Headers $h).value |
               Where-Object id -eq $ehDetail.properties.databasesItemIds[0]).displayName
Write-Info "cluster  = $clusterUri"
Write-Info "baza KQL = $kqlDbName"

if ($Step -in 'all', 'kql') {
    Write-Step 'Tabele i mapowania w Eventhouse'
    foreach ($file in @('01_create_tables.kql', '02_update_policies.kql')) {
        $path = Join-Path $RepoRoot "kql\$file"
        if (-not (Test-Path $path)) { continue }
        foreach ($cmd in Split-KqlCommands $path) {
            $head = $cmd.Split("`n")[0]
            $head = $head.Substring(0, [Math]::Min(85, $head.Length))
            try { Invoke-KustoMgmt $clusterUri $kqlDbName $cmd | Out-Null; Write-Ok $head }
            catch { Write-Warn "$head :: $($_.Exception.Message)" }
        }
    }
}

if ($Step -in 'all', 'upload') {
    Write-Step 'Wgrywanie plikow do OneLake'
    Get-ChildItem "$RepoRoot\datasets" -Filter *.csv | ForEach-Object {
        Send-ToOneLake $ws.id $lakehouse.id $_.FullName "datasets/$($_.Name)"
    }
    Get-ChildItem "$RepoRoot\datasets" -Filter *.jsonl | ForEach-Object {
        Send-ToOneLake $ws.id $lakehouse.id $_.FullName "streams/$($_.Name)"
    }
}

if ($Step -in 'all', 'ingest') {
    Write-Step 'Ladowanie strumieni do Eventhouse'
    # klucz = tabela KQL, wartosc = plik JSONL i referencja mapowania
    $map = [ordered]@{
        'TransportTracking' = @{ file = 'fact_transport_tracking'; mapping = 'TransportTrackingMapping' }
        'ShelterOccupancy'  = @{ file = 'fact_shelter_occupancy';  mapping = 'ShelterOccupancyMapping' }
        'Demand'            = @{ file = 'fact_demand';             mapping = 'DemandMapping' }
        'Allocation'        = @{ file = 'fact_allocation';         mapping = 'AllocationMapping' }
        'RoadStatus'        = @{ file = 'fact_road_status';        mapping = 'RoadStatusMapping' }
        'Consumption'       = @{ file = 'fact_consumption';        mapping = 'ConsumptionMapping' }
    }
    foreach ($table in $map.Keys) {
        $url = "https://onelake.dfs.fabric.microsoft.com/$($ws.id)/$($lakehouse.id)/Files/streams/$($map[$table].file).jsonl"
        try {
            Invoke-KustoMgmt $clusterUri $kqlDbName ".clear table $table data" | Out-Null
            $cmd = ".ingest into table $table ('$url;impersonate') with (format='multijson', ingestionMappingReference='$($map[$table].mapping)')"
            Invoke-KustoMgmt $clusterUri $kqlDbName $cmd | Out-Null
            Write-Ok "zaladowano $table"
        }
        catch { Write-Warn "$table :: $($_.Exception.Message)" }
    }

    # Wymiary sa potrzebne w Eventhouse, bo kafelki dashboardu (mapa, etykiety gmin)
    # nie moga siegac do tabel Delta w Lakehouse.
    Write-Step 'Ladowanie wymiarow do Eventhouse'
    $dims = [ordered]@{
        'dim_gmina'          = 'gmina_code:string, gmina_name:string, powiat_code:string, voivodeship_code:string, population:long, lat:real, lon:real'
        'dim_powiat'         = 'powiat_code:string, powiat_name:string, voivodeship_code:string, lat:real, lon:real'
        'dim_voivodeship'    = 'voivodeship_code:string, voivodeship_name:string, lat:real, lon:real'
        'dim_warehouse'      = 'warehouse_id:string, warehouse_name:string, owner_type:string, voivodeship_code:string, lat:real, lon:real, area_m2:real, has_ramp:int, available_24_7:int'
        'dim_resource_type'  = 'resource_type_id:string, resource_name:string, unit:string, category:string, weight_kg:real, volume_m3:real, requires_operator:int, setup_time_h:real'
        'dim_shelter'        = 'shelter_id:string, shelter_name:string, shelter_type:string, gmina_code:string, capacity:int, has_kitchen:int, has_medical_room:int, accessible_disabled:int, lat:real, lon:real'
        'dim_transport_unit' = 'transport_unit_id:string, transport_type:string, payload_t:real, avg_speed_kmh:real, base_warehouse_id:string, available_from:datetime, available:int'
    }
    foreach ($table in $dims.Keys) {
        $url = "https://onelake.dfs.fabric.microsoft.com/$($ws.id)/$($lakehouse.id)/Files/datasets/$table.csv"
        try {
            Invoke-KustoMgmt $clusterUri $kqlDbName ".create-merge table $table ($($dims[$table]))" | Out-Null
            Invoke-KustoMgmt $clusterUri $kqlDbName ".clear table $table data" | Out-Null
            Invoke-KustoMgmt $clusterUri $kqlDbName ".ingest into table $table ('$url;impersonate') with (format='csv', ignoreFirstRecord=true)" | Out-Null
            Write-Ok "zaladowano $table"
        }
        catch { Write-Warn "$table :: $($_.Exception.Message)" }
    }

    # fact_stock.csv jest migawka bez wlasnej daty - snapshot_date nadajemy przy przepisaniu
    # ze StockRaw, zeby DailyStockSnapshot mial na czym pracowac.
    Write-Step 'Stany magazynowe (StockRaw -> StockSnapshot)'
    $stockUrl = "https://onelake.dfs.fabric.microsoft.com/$($ws.id)/$($lakehouse.id)/Files/datasets/fact_stock.csv"
    try {
        Invoke-KustoMgmt $clusterUri $kqlDbName '.clear table StockRaw data' | Out-Null
        Invoke-KustoMgmt $clusterUri $kqlDbName ".ingest into table StockRaw ('$stockUrl;impersonate') with (format='csv', ignoreFirstRecord=true)" | Out-Null
        Invoke-KustoMgmt $clusterUri $kqlDbName '.clear table StockSnapshot data' | Out-Null
        Invoke-KustoMgmt $clusterUri $kqlDbName ".set-or-append StockSnapshot <| StockRaw | extend snapshot_date = datetime($ScenarioStartDate)" | Out-Null
        Write-Ok 'zaladowano StockSnapshot'
    }
    catch { Write-Warn "StockSnapshot :: $($_.Exception.Message)" }

    # Wnioski SPO-2 sa zrodlem reguly Activatora o przekroczeniu limitu finansowego,
    # dlatego musza byc w Eventhouse, a nie tylko w Lakehouse.
    Write-Step 'Wnioski finansowe SPO-2 (FinancialRequest)'
    $finUrl = "https://onelake.dfs.fabric.microsoft.com/$($ws.id)/$($lakehouse.id)/Files/datasets/fact_financial_request.csv"
    $finSchema = 'financial_request_id:string, timestamp:datetime, applicant:string, voivodeship_code:string, amount_pln:long, purpose:string, status:string, approval_path:string'
    try {
        Invoke-KustoMgmt $clusterUri $kqlDbName ".create-merge table FinancialRequest ($finSchema)" | Out-Null
        Invoke-KustoMgmt $clusterUri $kqlDbName '.clear table FinancialRequest data' | Out-Null
        Invoke-KustoMgmt $clusterUri $kqlDbName ".ingest into table FinancialRequest ('$finUrl;impersonate') with (format='csv', ignoreFirstRecord=true)" | Out-Null
        Write-Ok 'zaladowano FinancialRequest'
    }
    catch { Write-Warn "FinancialRequest :: $($_.Exception.Message)" }
}

if ($Step -in 'all', 'verify') {
    Write-Step 'Weryfikacja'
    # Allocation i StockSnapshot nie maja kolumny timestamp, wiec liczymy tylko rekordy.
    $q = 'union withsource=T * | summarize Rekordy = count() by Tabela = T | order by Tabela asc'
    $res  = Invoke-KustoQuery $clusterUri $kqlDbName $q
    $cols = $res.Tables[0].Columns.ColumnName
    $res.Tables[0].Rows | ForEach-Object {
        $row = $_; $o = [ordered]@{}
        for ($i = 0; $i -lt $cols.Count; $i++) { $o[$cols[$i]] = $row[$i] }
        [PSCustomObject]$o
    } | Format-Table -AutoSize
}

Write-Host "`nGotowe. Workspace: https://app.fabric.microsoft.com/groups/$($ws.id)" -ForegroundColor Cyan
