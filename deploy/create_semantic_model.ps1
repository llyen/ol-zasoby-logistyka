[CmdletBinding()]
param(
    [string]$WorkspaceName = 'OL-ZK-Demo-Zasoby',
    [string]$WorkspaceId = 'aebf1df2-3be8-4f89-9d8d-647ae519d50b',
    [string]$LakehouseId = 'dad1feb6-3eba-431d-8e9f-b00aba44344d',
    [string]$LakehouseName = 'OL_LOG_Lakehouse',
    [string]$SemanticModelName = 'OL_LOG_SemanticModel',
    [string]$ReportName = 'OL_LOG_Raport',
    [switch]$SkipReport
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$OutRoot = Join-Path $RepoRoot 'semantic-model\generated'
$ReportOutRoot = Join-Path $RepoRoot 'semantic-model\report'
New-Item -ItemType Directory -Force -Path $OutRoot, $ReportOutRoot | Out-Null

function Get-AccessToken([string]$Resource) {
    $token = az account get-access-token --resource $Resource --query accessToken -o tsv
    if (-not $token) { throw "Nie udało się pobrać tokenu dla $Resource. Uruchom az login." }
    return $token
}

function New-AuthHeaders([string]$Token) {
    return @{
        Authorization = "Bearer $Token"
        'Content-Type' = 'application/json; charset=utf-8'
    }
}

function Invoke-FabricJson {
    param(
        [ValidateSet('GET','POST','PATCH','DELETE')] [string]$Method,
        [string]$Uri,
        [hashtable]$Headers,
        $Body = $null
    )
    try {
        $json = if ($null -ne $Body) { $Body | ConvertTo-Json -Depth 100 -Compress } else { $null }
        if ($json) {
            return Invoke-WebRequest -Method $Method -Uri $Uri -Headers $Headers -Body $json
        }
        return Invoke-WebRequest -Method $Method -Uri $Uri -Headers $Headers
    }
    catch {
        $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'n/a' }
        $details = $_.ErrorDetails.Message
        if (-not $details) { $details = $_.Exception.Message }
        throw "REST $Method $Uri nie powiódł się ($status): $details"
    }
}

function Wait-FabricOperation {
    param([Microsoft.PowerShell.Commands.WebResponseObject]$Response, [hashtable]$Headers)
    if ([int]$Response.StatusCode -ne 202) { return }
    $location = @($Response.Headers.Location) | Select-Object -First 1
    if (-not $location) { return }
    do {
        Start-Sleep -Seconds 5
        $op = Invoke-FabricJson -Method GET -Uri $location -Headers $Headers
        $body = if ($op.Content) { $op.Content | ConvertFrom-Json } else { $null }
        $status = $body.status
        Write-Host "Operacja Fabric: $status"
        if ($status -eq 'Failed') {
            $code = $body.error.errorCode
            $msg = $body.error.message
            throw "Operacja Fabric zakończona błędem: $code $msg"
        }
    } while ($status -in @('Running','NotStarted'))
}

function ConvertTo-InlineBase64([string]$Text) {
    return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Text))
}

function New-Part([string]$Path, [string]$Text) {
    return @{ path = $Path; payload = (ConvertTo-InlineBase64 $Text); payloadType = 'InlineBase64' }
}

function Save-DefinitionPart([string]$Root, [string]$Path, [string]$Text) {
    $full = Join-Path $Root $Path
    $dir = Split-Path -Parent $full
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Set-Content -Path $full -Value $Text -Encoding utf8
}

function Get-Items([hashtable]$Headers) {
    $uri = "https://api.fabric.microsoft.com/v1/workspaces/$WorkspaceId/items"
    return (Invoke-FabricJson -Method GET -Uri $uri -Headers $Headers).Content | ConvertFrom-Json
}

function Find-Item([hashtable]$Headers, [string]$DisplayName, [string]$Type) {
    $items = Get-Items $Headers
    return @($items.value | Where-Object { $_.displayName -eq $DisplayName -and $_.type -eq $Type }) | Select-Object -First 1
}

function Get-LakehouseProperties([hashtable]$Headers) {
    $uri = "https://api.fabric.microsoft.com/v1/workspaces/$WorkspaceId/lakehouses/$LakehouseId"
    return ((Invoke-FabricJson -Method GET -Uri $uri -Headers $Headers).Content | ConvertFrom-Json).properties
}

$ColumnMap = [ordered]@{
    allocation_metrics = @(
        @('method','string'), @('served_demands','int64'), @('served_pct','double'), @('priority1_served','int64'), @('priority1_served_pct','double'), @('avg_delivery_time_h','double'), @('time_saved_h','double')
    )
    allocation_plan = @(
        @('demand_id','string'), @('priority','int64'), @('resource_type_id','string'), @('warehouse_id','string'), @('gmina_code','string'), @('voivodeship_code','string'), @('allocated_qty','int64'), @('travel_time_h','double'), @('method','string')
    )
    coverage_analysis = @(
        @('gmina_code','string'), @('gmina_name','string'), @('voivodeship_code','string'), @('lat','double'), @('lon','double'), @('nearest_warehouse_id','string'), @('nearest_warehouse_name','string'), @('distance_km','double'), @('access_time_h','double'), @('second_access_time_h','double'), @('third_access_time_h','double'), @('coverage_gap','boolean')
    )
    coverage_summary = @(
        @('affected_gminas','int64'), @('avg_access_time_h','double'), @('p90_access_time_h','double'), @('max_access_time_h','double'), @('coverage_gaps_gt_6h','int64')
    )
    depletion_forecast = @(
        @('voivodeship_code','string'), @('resource_type_id','string'), @('available_qty','int64'), @('daily_consumption','double'), @('days_of_stock','double'), @('recommendation','string'), @('alert_level','int64'), @('resource_name','string'), @('unit','string')
    )
    dim_gmina = @(
        @('gmina_code','string'), @('gmina_name','string'), @('powiat_code','string'), @('voivodeship_code','string'), @('population','int64'), @('lat','double'), @('lon','double'), @('ingested_at','dateTime')
    )
    dim_powiat = @(
        @('powiat_code','string'), @('powiat_name','string'), @('voivodeship_code','string'), @('lat','double'), @('lon','double'), @('ingested_at','dateTime')
    )
    dim_resource_type = @(
        @('resource_type_id','string'), @('resource_name','string'), @('unit','string'), @('category','string'), @('weight_kg','double'), @('volume_m3','double'), @('requires_operator','int64'), @('setup_time_h','double'), @('ingested_at','dateTime')
    )
    dim_shelter = @(
        @('shelter_id','string'), @('shelter_name','string'), @('shelter_type','string'), @('gmina_code','string'), @('capacity','int64'), @('has_kitchen','int64'), @('has_medical_room','int64'), @('accessible_disabled','int64'), @('lat','double'), @('lon','double'), @('ingested_at','dateTime')
    )
    dim_supplier = @(
        @('supplier_id','string'), @('supplier_name','string'), @('category','string'), @('voivodeship_code','string'), @('lead_time_h','double'), @('contract_limit','int64'), @('ingested_at','dateTime')
    )
    dim_transport_unit = @(
        @('transport_unit_id','string'), @('transport_type','string'), @('payload_t','double'), @('avg_speed_kmh','double'), @('base_warehouse_id','string'), @('available_from','dateTime'), @('available','int64'), @('ingested_at','dateTime')
    )
    dim_voivodeship = @(
        @('voivodeship_code','string'), @('voivodeship_name','string'), @('lat','double'), @('lon','double'), @('ingested_at','dateTime')
    )
    dim_warehouse = @(
        @('warehouse_id','string'), @('warehouse_name','string'), @('owner_type','string'), @('voivodeship_code','string'), @('lat','double'), @('lon','double'), @('area_m2','double'), @('has_ramp','int64'), @('available_24_7','int64'), @('ingested_at','dateTime')
    )
    fact_allocation = @(
        @('allocated_qty','int64'), @('allocation_id','string'), @('decision_level','string'), @('demand_id','string'), @('eta','dateTime'), @('status','string'), @('transport_unit_id','string'), @('warehouse_id','string'), @('ingested_at','dateTime')
    )
    fact_consumption = @(
        @('consumed_qty','int64'), @('resource_type_id','string'), @('site_id','string'), @('timestamp','dateTime'), @('voivodeship_code','string'), @('ingested_at','dateTime')
    )
    fact_demand = @(
        @('day_label','string'), @('demand_id','string'), @('gmina_code','string'), @('justification','string'), @('powiat_code','string'), @('priority','int64'), @('quantity','int64'), @('reported_by','string'), @('resource_type_id','string'), @('timestamp','dateTime'), @('voivodeship_code','string'), @('ingested_at','dateTime')
    )
    fact_financial_request = @(
        @('financial_request_id','string'), @('timestamp','dateTime'), @('applicant','string'), @('voivodeship_code','string'), @('amount_pln','int64'), @('purpose','string'), @('status','string'), @('approval_path','string'), @('ingested_at','dateTime')
    )
    fact_road_status = @(
        @('lat','double'), @('lon','double'), @('reason','string'), @('road_name','string'), @('road_segment_id','string'), @('status','string'), @('timestamp','dateTime'), @('voivodeship_code','string'), @('ingested_at','dateTime')
    )
    fact_shelter_occupancy = @(
        @('capacity','int64'), @('medical_care_required','int64'), @('occupied','int64'), @('shelter_id','string'), @('timestamp','dateTime'), @('ingested_at','dateTime')
    )
    fact_stock = @(
        @('warehouse_id','string'), @('resource_type_id','string'), @('available_qty','int64'), @('reserved_qty','int64'), @('in_transit_qty','int64'), @('expiry_date','string'), @('ingested_at','dateTime')
    )
    fact_transport_tracking = @(
        @('allocation_id','string'), @('delay_min','int64'), @('eta','dateTime'), @('lat','double'), @('lon','double'), @('speed_kmh','double'), @('status','string'), @('timestamp','dateTime'), @('transport_id','string'), @('ingested_at','dateTime')
    )
}

$Measures = @(
    @{Name='Zapotrzebowania'; Expression='COUNTROWS(fact_demand)'; Format='#,0'},
    @{Name='Zapotrzebowania Priorytet 1'; Expression='CALCULATE(COUNTROWS(fact_demand), fact_demand[priority] = 1)'; Format='#,0'},
    @{Name='Zapotrzebowana Ilosc'; Expression='SUM(fact_demand[quantity])'; Format='#,0'},
    @{Name='Przydzielona Ilosc'; Expression='SUM(fact_allocation[allocated_qty])'; Format='#,0'},
    @{Name='Pokrycie Zapotrzebowan %'; Expression='DIVIDE(SUM(fact_allocation[allocated_qty]), SUM(fact_demand[quantity]))'; Format='0.0%'},
    @{Name='Gminy z Zapotrzebowaniem'; Expression='DISTINCTCOUNT(fact_demand[gmina_code])'; Format='#,0'},
    @{Name='Transporty'; Expression='DISTINCTCOUNT(fact_transport_tracking[transport_id])'; Format='#,0'},
    @{Name='Transporty Opoznione'; Expression='CALCULATE(DISTINCTCOUNT(fact_transport_tracking[transport_id]), fact_transport_tracking[delay_min] > 30)'; Format='#,0'},
    @{Name='Maksymalne Opoznienie Min'; Expression='MAX(fact_transport_tracking[delay_min])'; Format='#,0'},
    @{Name='Srednia Predkosc kmh'; Expression='AVERAGE(fact_transport_tracking[speed_kmh])'; Format='0.0'},
    @{Name='Osoby w Punktach Przyjecia'; Expression='MAXX(VALUES(fact_shelter_occupancy[timestamp]), CALCULATE(SUM(fact_shelter_occupancy[occupied])))'; Format='#,0'},
    @{Name='Pojemnosc Punktow'; Expression='SUMX(VALUES(fact_shelter_occupancy[shelter_id]), CALCULATE(MAX(fact_shelter_occupancy[capacity])))'; Format='#,0'},
    @{Name='Oblozenie Punktow %'; Expression='DIVIDE(MAXX(VALUES(fact_shelter_occupancy[timestamp]), CALCULATE(SUM(fact_shelter_occupancy[occupied]))), SUMX(VALUES(fact_shelter_occupancy[shelter_id]), CALCULATE(MAX(fact_shelter_occupancy[capacity]))))'; Format='0.0%'},
    @{Name='Punkty Powyzej 90%'; Expression='COUNTROWS(FILTER(VALUES(fact_shelter_occupancy[shelter_id]), CALCULATE(DIVIDE(MAX(fact_shelter_occupancy[occupied]), MAX(fact_shelter_occupancy[capacity]))) > 0.9))'; Format='#,0'},
    @{Name='Wymagajacy Opieki Medycznej'; Expression='MAXX(VALUES(fact_shelter_occupancy[timestamp]), CALCULATE(SUM(fact_shelter_occupancy[medical_care_required])))'; Format='#,0'},
    @{Name='Zapas Dostepny'; Expression='SUM(fact_stock[available_qty])'; Format='#,0'},
    @{Name='Zapas Zarezerwowany'; Expression='SUM(fact_stock[reserved_qty])'; Format='#,0'},
    @{Name='Zapas w Drodze'; Expression='SUM(fact_stock[in_transit_qty])'; Format='#,0'},
    @{Name='Zuzycie Narastajaco'; Expression='SUM(fact_consumption[consumed_qty])'; Format='#,0'},
    @{Name='Krytyczne Braki Zapasu'; Expression='CALCULATE(COUNTROWS(depletion_forecast), depletion_forecast[days_of_stock] < 2)'; Format='#,0'},
    @{Name='Minimalne Dni Zapasu'; Expression='MIN(depletion_forecast[days_of_stock])'; Format='0.0'},
    @{Name='Odcinki Nieprzejezdne'; Expression='CALCULATE(DISTINCTCOUNT(fact_road_status[road_segment_id]), fact_road_status[status] = "nieprzejezdna")'; Format='#,0'},
    @{Name='Odcinki z Utrudnieniami'; Expression='CALCULATE(DISTINCTCOUNT(fact_road_status[road_segment_id]), fact_road_status[status] = "utrudnienia")'; Format='#,0'},
    @{Name='Sredni Czas Dojazdu h'; Expression='AVERAGE(coverage_analysis[access_time_h])'; Format='0.00'},
    @{Name='P90 Czas Dojazdu h'; Expression='AVERAGE(coverage_summary[p90_access_time_h])'; Format='0.00'},
    @{Name='Luki Pokrycia Ponad 6h'; Expression='SUM(coverage_summary[coverage_gaps_gt_6h])'; Format='#,0'},
    @{Name='Sredni Czas FIFO h'; Expression='CALCULATE(AVERAGE(allocation_metrics[avg_delivery_time_h]), allocation_metrics[method] = "fifo")'; Format='0.00'},
    @{Name='Sredni Czas Optymalizacja h'; Expression='CALCULATE(AVERAGE(allocation_metrics[avg_delivery_time_h]), allocation_metrics[method] = "optimized")'; Format='0.00'},
    @{Name='Czas Zaoszczedzony h'; Expression='AVERAGE(allocation_metrics[time_saved_h])'; Format='0.00'},
    @{Name='Priorytet 1 Obsluzony %'; Expression='CALCULATE(AVERAGE(allocation_metrics[priority1_served_pct]), allocation_metrics[method] = "optimized") / 100'; Format='0.0%'},
    @{Name='Koszt Operacji PLN'; Expression='SUMX(FILTER(allocation_plan, allocation_plan[method] = "optimized"), allocation_plan[allocated_qty] * RELATED(dim_resource_type[weight_kg]) * 0.45)'; Format='#,0'},
    @{Name='SPO-2 Wnioskowane PLN'; Expression='SUM(fact_financial_request[amount_pln])'; Format='#,0'},
    @{Name='SPO-2 Powyzej Limitu'; Expression='CALCULATE(COUNTROWS(fact_financial_request), fact_financial_request[amount_pln] > 5000000)'; Format='#,0'},
    @{Name='Magazyny'; Expression='DISTINCTCOUNT(dim_warehouse[warehouse_id])'; Format='#,0'},
    @{Name='Ludnosc Objeta Zapotrzebowaniem'; Expression='CALCULATE(SUM(dim_gmina[population]), FILTER(VALUES(dim_gmina[gmina_code]), CALCULATE(COUNTROWS(fact_demand)) > 0))'; Format='#,0'}
)

$Relationships = @(
    @('rel_dim_powiat_dim_voivodeship','dim_powiat.voivodeship_code','dim_voivodeship.voivodeship_code'),
    @('rel_dim_gmina_dim_powiat','dim_gmina.powiat_code','dim_powiat.powiat_code'),
    @('rel_dim_shelter_dim_gmina','dim_shelter.gmina_code','dim_gmina.gmina_code'),
    @('rel_dim_warehouse_dim_voivodeship','dim_warehouse.voivodeship_code','dim_voivodeship.voivodeship_code'),
    @('rel_dim_transport_unit_dim_warehouse','dim_transport_unit.base_warehouse_id','dim_warehouse.warehouse_id'),
    @('rel_dim_supplier_dim_voivodeship','dim_supplier.voivodeship_code','dim_voivodeship.voivodeship_code'),
    @('rel_fact_demand_dim_gmina','fact_demand.gmina_code','dim_gmina.gmina_code'),
    @('rel_fact_demand_dim_resource_type','fact_demand.resource_type_id','dim_resource_type.resource_type_id'),
    @('rel_fact_allocation_fact_demand','fact_allocation.demand_id','fact_demand.demand_id'),
    @('rel_fact_transport_tracking_fact_allocation','fact_transport_tracking.allocation_id','fact_allocation.allocation_id'),
    @('rel_fact_shelter_occupancy_dim_shelter','fact_shelter_occupancy.shelter_id','dim_shelter.shelter_id'),
    @('rel_fact_stock_dim_warehouse','fact_stock.warehouse_id','dim_warehouse.warehouse_id'),
    @('rel_fact_stock_dim_resource_type','fact_stock.resource_type_id','dim_resource_type.resource_type_id'),
    @('rel_fact_consumption_dim_resource_type','fact_consumption.resource_type_id','dim_resource_type.resource_type_id'),
    @('rel_fact_road_status_dim_voivodeship','fact_road_status.voivodeship_code','dim_voivodeship.voivodeship_code'),
    @('rel_fact_financial_request_dim_voivodeship','fact_financial_request.voivodeship_code','dim_voivodeship.voivodeship_code'),
    @('rel_coverage_analysis_dim_gmina','coverage_analysis.gmina_code','dim_gmina.gmina_code'),
    @('rel_depletion_forecast_dim_resource_type','depletion_forecast.resource_type_id','dim_resource_type.resource_type_id'),
    @('rel_allocation_plan_dim_resource_type','allocation_plan.resource_type_id','dim_resource_type.resource_type_id'),
    @('rel_allocation_plan_dim_gmina','allocation_plan.gmina_code','dim_gmina.gmina_code')
)

function Quote-TmdlName([string]$Name) {
    if ($Name -match '[\s\.=:'']') { return "'" + $Name.Replace("'","''") + "'" }
    return $Name
}

function New-TableTmdl([string]$TableName, [array]$Columns, [string]$ExpressionName, [bool]$UseSchemaName, [array]$MeasuresForTable) {
    $qTable = Quote-TmdlName $TableName
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add("table $qTable")
    $lines.Add("`tsourceLineageTag: [dbo].[$TableName]")
    $lines.Add("")
    foreach ($c in $Columns) {
        $name = $c[0]; $type = $c[1]
        $qCol = Quote-TmdlName $name
        $lines.Add("`tcolumn $qCol")
        $lines.Add("`t`tdataType: $type")
        if ($type -eq 'int64') { $lines.Add("`t`tformatString: 0") }
        $summ = if ($type -in @('string','dateTime','boolean')) { 'none' } else { 'sum' }
        $lines.Add("`t`tsourceLineageTag: $name")
        $lines.Add("`t`tsummarizeBy: $summ")
        $lines.Add("`t`tsourceColumn: $name")
        $lines.Add("")
    }
    foreach ($m in $MeasuresForTable) {
        $qMeasure = Quote-TmdlName $m.Name
        $lines.Add("`tmeasure $qMeasure = $($m.Expression)")
        $lines.Add("`t`tformatString: $($m.Format)")
        $lines.Add("")
    }
    $lines.Add("`tpartition $qTable = entity")
    $lines.Add("`t`tmode: directLake")
    $lines.Add("`t`tsource")
    $lines.Add("`t`t`tentityName: $TableName")
    if ($UseSchemaName) { $lines.Add("`t`t`tschemaName: dbo") }
    $lines.Add("`t`t`texpressionSource: $(Quote-TmdlName $ExpressionName)")
    return ($lines -join "`r`n")
}

function New-SemanticDefinition([string[]]$Tables, [string]$ExpressionName, [string]$SourceUrl, [bool]$UseSchemaName, [string]$SourceKind = 'OneLake', [string]$SqlServer = '') {
    $parts = [System.Collections.Generic.List[object]]::new()
    $db = "database`r`n`tcompatibilityLevel: 1604`r`n"
    $modelLines = [System.Collections.Generic.List[string]]::new()
    $modelLines.Add("model Model")
    $modelLines.Add("`tculture: pl-PL")
    $modelLines.Add("`tdefaultPowerBIDataSourceVersion: powerBI_V3")
    $modelLines.Add("`tsourceQueryCulture: pl-PL")
    $modelLines.Add("`tdataAccessOptions")
    $modelLines.Add("`t`tlegacyRedirects")
    $modelLines.Add("`t`treturnErrorValuesAsNull")
    $modelLines.Add("")
    $modelLines.Add("annotation PBI_QueryOrder = [""$ExpressionName""]")
    $modelLines.Add("")
    $modelLines.Add("annotation __PBI_TimeIntelligenceEnabled = 1")
    $modelLines.Add("")
    $modelLines.Add("annotation PBI_ProTooling = [""DirectLakeOnOneLakeInWeb""]")
    $modelLines.Add("")
    foreach ($t in $Tables) { $modelLines.Add("ref table $(Quote-TmdlName $t)") }
    $model = $modelLines -join "`r`n"

    if ($SourceKind -eq 'SqlEndpoint') {
        $expr = @"
expression $(Quote-TmdlName $ExpressionName) =
		let
		    Source = Sql.Database("$SqlServer", "$LakehouseName")
		in
		    Source

	annotation PBI_IncludeFutureArtifacts = False
"@
    }
    else {
        $expr = @"
expression $(Quote-TmdlName $ExpressionName) =
		let
		    Source = AzureStorage.DataLake("$SourceUrl", [HierarchicalNavigation=true])
		in
		    Source

	annotation PBI_IncludeFutureArtifacts = False
"@
    }

    $relLines = [System.Collections.Generic.List[string]]::new()
    foreach ($r in $Relationships) {
        $fromTable = $r[1].Split('.')[0]
        $toTable = $r[2].Split('.')[0]
        if ($Tables -contains $fromTable -and $Tables -contains $toTable) {
            $relLines.Add("relationship $($r[0])")
            $relLines.Add("`tfromColumn: $($r[1])")
            $relLines.Add("`ttoColumn: $($r[2])")
            $relLines.Add("")
        }
    }
    $relationships = $relLines -join "`r`n"

    $parts.Add((New-Part 'definition/database.tmdl' $db))
    Save-DefinitionPart $OutRoot 'definition\database.tmdl' $db
    $parts.Add((New-Part 'definition/model.tmdl' $model))
    Save-DefinitionPart $OutRoot 'definition\model.tmdl' $model
    $parts.Add((New-Part 'definition/expressions.tmdl' $expr))
    Save-DefinitionPart $OutRoot 'definition\expressions.tmdl' $expr
    if ($relationships.Trim()) {
        $parts.Add((New-Part 'definition/relationships.tmdl' $relationships))
        Save-DefinitionPart $OutRoot 'definition\relationships.tmdl' $relationships
    }
    foreach ($t in $Tables) {
        # Miary trzymamy w jednej tabeli pomocniczej, zeby nie miesza sie z kolumnami faktow.
        $meas = if ($t -eq 'coverage_summary') { $Measures } else { @() }
        $text = New-TableTmdl -TableName $t -Columns $ColumnMap[$t] -ExpressionName $ExpressionName -UseSchemaName $UseSchemaName -MeasuresForTable $meas
        $parts.Add((New-Part "definition/tables/$t.tmdl" $text))
        Save-DefinitionPart $OutRoot "definition\tables\$t.tmdl" $text
    }
    $pbism = @{
        '$schema' = 'https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json'
        version = '5.0'
        settings = @{ qnaEnabled = $false }
    } | ConvertTo-Json -Depth 10
    $platform = @{
        '$schema' = 'https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json'
        metadata = @{ type = 'SemanticModel'; displayName = $SemanticModelName }
        config = @{ version = '2.0'; logicalId = ([guid]::NewGuid().ToString()) }
    } | ConvertTo-Json -Depth 10
    $parts.Add((New-Part 'definition.pbism' $pbism))
    Save-DefinitionPart $OutRoot 'definition.pbism' $pbism
    $parts.Add((New-Part '.platform' $platform))
    Save-DefinitionPart $OutRoot '.platform' $platform
    return @{ format = 'TMDL'; parts = @($parts) }
}

function Upsert-SemanticModel([hashtable]$Headers) {
    $existing = Find-Item -Headers $Headers -DisplayName $SemanticModelName -Type 'SemanticModel'
    $lakePropsForSql = Get-LakehouseProperties $Headers
    $sqlServer = $lakePropsForSql.sqlEndpointProperties.connectionString
    $minimalTables = @('dim_gmina','fact_demand','coverage_summary')
    $fullTables = @($ColumnMap.Keys)
    $candidates = @(
        @{ ExpressionName='DirectLake - OL_LOG_Lakehouse'; SourceUrl="https://onelake.dfs.fabric.microsoft.com/$WorkspaceId/$LakehouseId"; UseSchemaName=$true; SourceKind='OneLake'; SqlServer='' },
        @{ ExpressionName='DirectLake - OL_LOG_Lakehouse'; SourceUrl="https://onelake.dfs.fabric.microsoft.com/$WorkspaceId/$LakehouseId"; UseSchemaName=$false; SourceKind='OneLake'; SqlServer='' },
        @{ ExpressionName='DirectLakeConnection'; SourceUrl="https://onelake.dfs.fabric.microsoft.com/$WorkspaceId/$LakehouseId"; UseSchemaName=$true; SourceKind='OneLake'; SqlServer='' },
        @{ ExpressionName='DirectLakeConnection'; SourceUrl="https://onelake.dfs.fabric.microsoft.com/$WorkspaceId/$LakehouseId"; UseSchemaName=$false; SourceKind='OneLake'; SqlServer='' },
        @{ ExpressionName='DirectLake - OL_LOG_Lakehouse'; SourceUrl="https://onelake.dfs.fabric.microsoft.com/$WorkspaceId/$LakehouseId/Tables"; UseSchemaName=$true; SourceKind='OneLake'; SqlServer='' },
        @{ ExpressionName='DirectLake - OL_LOG_Lakehouse'; SourceUrl="https://onelake.dfs.fabric.microsoft.com/$WorkspaceId/$LakehouseId/Tables"; UseSchemaName=$false; SourceKind='OneLake'; SqlServer='' },
        @{ ExpressionName='DirectLakeConnection'; SourceUrl="https://onelake.dfs.fabric.microsoft.com/$WorkspaceId/$LakehouseId/Tables"; UseSchemaName=$true; SourceKind='OneLake'; SqlServer='' },
        @{ ExpressionName='DirectLakeConnection'; SourceUrl="https://onelake.dfs.fabric.microsoft.com/$WorkspaceId/$LakehouseId/Tables"; UseSchemaName=$false; SourceKind='OneLake'; SqlServer='' },
        @{ ExpressionName='DirectLakeSqlEndpoint'; SourceUrl=''; UseSchemaName=$false; SourceKind='SqlEndpoint'; SqlServer=$sqlServer }
    )
    $successCandidate = $null
    if (-not $existing) {
        for ($i = 0; $i -lt $candidates.Count; $i++) {
            $c = $candidates[$i]
            Write-Host "Próba Direct Lake $($i+1)/8: minimalny model, source=$($c.SourceUrl), schemaName=$($c.UseSchemaName), expression=$($c.ExpressionName)"
            try {
                $definition = New-SemanticDefinition -Tables $minimalTables -ExpressionName $c.ExpressionName -SourceUrl $c.SourceUrl -UseSchemaName $c.UseSchemaName -SourceKind $c.SourceKind -SqlServer $c.SqlServer
                $body = @{ displayName = $SemanticModelName; description = 'Model semantyczny Direct Lake COP-24 utworzony przez Fabric REST API'; definition = $definition }
                $resp = Invoke-FabricJson -Method POST -Uri "https://api.fabric.microsoft.com/v1/workspaces/$WorkspaceId/semanticModels" -Headers $Headers -Body $body
                Wait-FabricOperation -Response $resp -Headers $Headers
                Start-Sleep -Seconds 8
                $existing = Find-Item -Headers $Headers -DisplayName $SemanticModelName -Type 'SemanticModel'
                if (-not $existing) { throw 'Model nie pojawił się na liście elementów po utworzeniu.' }
                $successCandidate = $c
                break
            }
            catch {
                Write-Warning $_.Exception.Message
            }
        }
    }
    else {
        # Tabele leza w Tables/<nazwa> (lakehouse bez schematow), wiec uzywamy wariantu
        # OneLake bez schemaName. Wariant SQL endpoint wymagalby schematu dbo i konczyl
        # sie bledem "cannot access the source Delta table" przy przeframowaniu.
        $successCandidate = $candidates[1]
        Write-Host "Model $SemanticModelName już istnieje: $($existing.id). Używam updateDefinition."
    }
    if (-not $existing -or -not $successCandidate) { throw 'Nie udało się utworzyć minimalnego modelu Direct Lake po 8 próbach.' }

    Write-Host "Aktualizacja do pełnego modelu: $($fullTables.Count) tabel."
    $fullDefinition = New-SemanticDefinition -Tables $fullTables -ExpressionName $successCandidate.ExpressionName -SourceUrl $successCandidate.SourceUrl -UseSchemaName $successCandidate.UseSchemaName -SourceKind $successCandidate.SourceKind -SqlServer $successCandidate.SqlServer
    try {
        $body = @{ definition = $fullDefinition }
        $resp = Invoke-FabricJson -Method POST -Uri "https://api.fabric.microsoft.com/v1/workspaces/$WorkspaceId/items/$($existing.id)/updateDefinition?updateMetadata=True" -Headers $Headers -Body $body
        Wait-FabricOperation -Response $resp -Headers $Headers
    }
    catch {
        Write-Warning "Pelny model z fact_transport_tracking nie powiódł się: $($_.Exception.Message)"
        $reducedTables = @($fullTables | Where-Object { $_ -ne 'fact_transport_tracking' })
        Write-Host "Ponawiam pełny zakres bez duzej tabeli fact_transport_tracking: $($reducedTables.Count) tabel."
        $fullDefinition = New-SemanticDefinition -Tables $reducedTables -ExpressionName $successCandidate.ExpressionName -SourceUrl $successCandidate.SourceUrl -UseSchemaName $successCandidate.UseSchemaName -SourceKind $successCandidate.SourceKind -SqlServer $successCandidate.SqlServer
        $body = @{ definition = $fullDefinition }
        $resp = Invoke-FabricJson -Method POST -Uri "https://api.fabric.microsoft.com/v1/workspaces/$WorkspaceId/items/$($existing.id)/updateDefinition?updateMetadata=True" -Headers $Headers -Body $body
        Wait-FabricOperation -Response $resp -Headers $Headers
    }
    return (Find-Item -Headers $Headers -DisplayName $SemanticModelName -Type 'SemanticModel')
}

function New-ReportDefinition([string]$SemanticModelId, [string]$Mode) {
    if ($Mode -ne 'PBIR') { throw 'Raport COP-24 jest generowany wyłącznie w działającym formacie PBIR.' }
    if (Test-Path $ReportOutRoot) { Remove-Item -Recurse -Force $ReportOutRoot }
    New-Item -ItemType Directory -Force -Path $ReportOutRoot | Out-Null

    function New-Lit([string]$Value) { return @{ expr = @{ Literal = @{ Value = $Value } } } }
    function New-Col([string]$Table, [string]$Column) { return @{ Column = @{ Expression = @{ SourceRef = @{ Entity = $Table } }; Property = $Column } } }
    function New-Meas([string]$Table, [string]$Measure) { return @{ Measure = @{ Expression = @{ SourceRef = @{ Entity = $Table } }; Property = $Measure } } }
    function New-Agg([string]$Table, [string]$Column, [int]$Function) { return @{ Aggregation = @{ Expression = (New-Col $Table $Column); Function = $Function } } }
    function New-Proj($Field, [string]$QueryRef, [string]$NativeRef, [string]$DisplayName = '') {
        $p = [ordered]@{ field = $Field; queryRef = $QueryRef; nativeQueryRef = $NativeRef }
        if ($DisplayName) { $p.displayName = $DisplayName }
        return $p
    }
    function New-TitleVco([string]$Title) {
        return @{ title = @(@{ properties = @{ show = (New-Lit 'true'); text = (New-Lit ("'$Title'")); fontSize = (New-Lit '12D'); bold = (New-Lit 'true') } }) }
    }
    function New-DataVisual([string]$Name, [string]$Type, [string]$Title, [int]$X, [int]$Y, [int]$W, [int]$H, [hashtable]$Roles, $SortField = $null) {
        $queryState = [ordered]@{}
        foreach ($role in $Roles.Keys) { $queryState[$role] = @{ projections = @($Roles[$role]) } }
        $query = [ordered]@{ queryState = $queryState }
        if ($SortField) { $query.sortDefinition = @{ sort = @(@{ field = $SortField; direction = 'Descending' }); isDefaultSort = $false } }
        $visual = [ordered]@{
            '$schema' = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/1.0.0/schema.json'
            name = $Name
            position = @{ x = $X; y = $Y; z = 1000; height = $H; width = $W; tabOrder = 1000 }
            visual = [ordered]@{
                visualType = $Type
                query = $query
                visualContainerObjects = (New-TitleVco $Title)
                drillFilterOtherVisuals = $true
            }
        }
        if ($Type -in @('tableEx','pivotTable')) {
            $visual.visual.objects = @{ columnHeaders = @(@{ properties = @{ columnAdjustment = (New-Lit "'growToFit'"); autoSizeColumnWidth = (New-Lit 'true') } }) }
            $visual.visual.visualContainerObjects.stylePreset = @(@{ properties = @{ name = (New-Lit "'None'") } })
        }
        return $visual
    }
    function New-TextboxVisual([string]$Name, [string]$Text, [int]$X, [int]$Y, [int]$W, [int]$H) {
        return [ordered]@{
            '$schema' = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/1.0.0/schema.json'
            name = $Name
            position = @{ x = $X; y = $Y; z = 2000; height = $H; width = $W; tabOrder = 0 }
            visual = [ordered]@{
                visualType = 'textbox'
                objects = @{ general = @(@{ properties = @{ paragraphs = @(@{ textRuns = @(@{ value = $Text; textStyle = @{ fontFamily = 'Segoe UI Semibold'; fontSize = '24px'; color = '#0F172A' } }); horizontalTextAlignment = 'left' }) } }) }
                visualContainerObjects = @{ background = @(@{ properties = @{ show = (New-Lit 'false') } }); border = @(@{ properties = @{ show = (New-Lit 'false') } }) }
            }
        }
    }

    $parts = [System.Collections.Generic.List[object]]::new()
    $pbir = @{
        '$schema' = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json'
        version = '4.0'
        datasetReference = @{ byConnection = @{ connectionString = "semanticmodelid=$SemanticModelId" } }
    } | ConvertTo-Json -Depth 10
    $platform = @{
        '$schema' = 'https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json'
        metadata = @{ type = 'Report'; displayName = $ReportName }
        config = @{ version = '2.0'; logicalId = 'a0449186-59df-49f4-a151-9ceceb06726e' }
    } | ConvertTo-Json -Depth 10
    $report = @{
        '$schema' = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/3.1.0/schema.json'
        themeCollection = @{ baseTheme = @{ name = 'CY25SU12'; type = 'SharedResources'; reportVersionAtImport = @{ visual = '2.5.0'; page = '2.3.0'; report = '3.1.0' } } }
        settings = @{ useStylableVisualContainerHeader = $true; defaultFilterActionIsDataFilter = $true; useEnhancedTooltips = $true }
    } | ConvertTo-Json -Depth 20
    $version = @{
        '$schema' = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json'
        version = '2.0.0'
    } | ConvertTo-Json -Depth 5
    $pageIds = @('obraz-kraju','wojewodztwo-gminy','infrastruktura-krytyczna','eskalacja-spo')
    $pages = @{ '$schema' = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.0.0/schema.json'; pageOrder = $pageIds; activePageName = $pageIds[0] } | ConvertTo-Json -Depth 10
    $parts.Add((New-Part 'definition.pbir' $pbir)); Save-DefinitionPart $ReportOutRoot 'definition.pbir' $pbir
    $parts.Add((New-Part '.platform' $platform)); Save-DefinitionPart $ReportOutRoot '.platform' $platform
    $parts.Add((New-Part 'definition/report.json' $report)); Save-DefinitionPart $ReportOutRoot 'definition\report.json' $report
    $parts.Add((New-Part 'definition/version.json' $version)); Save-DefinitionPart $ReportOutRoot 'definition\version.json' $version
    $parts.Add((New-Part 'definition/pages/pages.json' $pages)); Save-DefinitionPart $ReportOutRoot 'definition\pages\pages.json' $pages

    $titles = @{
        'obraz-kraju' = 'Obraz kraju'
        'wojewodztwo-gminy' = 'Województwo i gminy'
        'infrastruktura-krytyczna' = 'Infrastruktura krytyczna'
        'eskalacja-spo' = 'Eskalacja i SPO'
    }
    foreach ($p in $pageIds) {
        $page = @{
            '$schema' = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.0.0/schema.json'
            name = $p
            displayName = $titles[$p]
            displayOption = 'FitToPage'
            height = 720
            width = 1280
        } | ConvertTo-Json -Depth 10
        $parts.Add((New-Part "definition/pages/$p/page.json" $page))
        Save-DefinitionPart $ReportOutRoot "definition\pages\$p\page.json" $page
    }

    $mKis = New-Meas 'kis_country' 'KIS'
    $mKisMax = New-Meas 'kis_country' 'KIS Max Lokalny'
    $mAlarm = New-Meas 'kis_country' 'Alarm Hydro'
    $mAffected = New-Meas 'kis_country' 'Osoby Dotkniete'
    $mEvac = New-Meas 'kis_country' 'Liczba Ewakuowanych'
    $mPower = New-Meas 'kis_country' 'Odbiorcy Bez Prądu'
    $mInc = New-Meas 'kis_country' 'Incydenty'
    $mTelco = New-Meas 'kis_country' 'Gminy Telco Ponizej 50'
    $mRzzk = New-Meas 'kis_country' 'Rekomendacje RZZK'
    $mPsp = New-Meas 'kis_country' 'PSP Zastepy'
    $mWot = New-Meas 'kis_country' 'WOT Zolnierze'
    $mPumps = New-Meas 'kis_country' 'Pompy'
    $sumPower = New-Agg 'power_grid_events' 'customers_offline' 0
    $sumBase = New-Agg 'telecom_events' 'base_stations_down' 0
    $sumHydro = New-Agg 'hydro_readings' 'level_cm' 1
    $countEsc = New-Agg 'escalation_events' 'event_id' 2

    $visuals = @{
        'obraz-kraju' = @(
            (New-TextboxVisual 'v_p1_title' 'Obraz kraju — wspólny obraz sytuacji COP-24' 20 15 900 45),
            (New-DataVisual 'v_p1_card_alarm' 'card' 'Gminy/wodowskazy w alarmie' 20 70 290 95 @{ Values = @((New-Proj $mAlarm 'kis_country.Alarm Hydro' 'Alarm Hydro' 'Alarm hydro')) }),
            (New-DataVisual 'v_p1_card_people' 'card' 'Osoby objęte zgłoszeniami' 330 70 290 95 @{ Values = @((New-Proj $mAffected 'kis_country.Osoby Dotkniete' 'Osoby Dotkniete' 'Osoby dotknięte')) }),
            (New-DataVisual 'v_p1_card_evac' 'card' 'Osoby w ewakuacji' 640 70 290 95 @{ Values = @((New-Proj $mEvac 'kis_country.Liczba Ewakuowanych' 'Liczba Ewakuowanych' 'Ewakuowani')) }),
            (New-DataVisual 'v_p1_card_power' 'card' 'Odbiorcy bez prądu' 950 70 290 95 @{ Values = @((New-Proj $mPower 'kis_country.Odbiorcy Bez Prądu' 'Odbiorcy Bez Prądu' 'Bez prądu')) }),
            (New-DataVisual 'v_p1_kis_voiv' 'clusteredColumnChart' 'KIS wg województw' 20 185 390 220 @{ Category = @((New-Proj (New-Col 'dim_voivodeship' 'voivodeship_name') 'dim_voivodeship.voivodeship_name' 'Województwo' 'Województwo')); Y = @((New-Proj $mKis 'kis_country.KIS' 'KIS' 'KIS')) } $mKis),
            (New-DataVisual 'v_p1_inc_time' 'lineChart' 'Incydenty w czasie' 430 185 390 220 @{ Category = @((New-Proj (New-Col 'incident_reports' 'timestamp') 'incident_reports.timestamp' 'Czas' 'Czas')); Y = @((New-Proj $mInc 'kis_country.Incydenty' 'Incydenty' 'Incydenty')) }),
            (New-DataVisual 'v_p1_map_gminy' 'azureMap' 'Mapa gmin wg KIS' 840 185 400 480 @{ Category = @((New-Proj (New-Col 'dim_gmina' 'gmina_name') 'dim_gmina.gmina_name' 'Gmina' 'Gmina')); X = @((New-Proj (New-Col 'dim_gmina' 'lon') 'dim_gmina.lon' 'Długość' 'Długość geogr.')); Y = @((New-Proj (New-Col 'dim_gmina' 'lat') 'dim_gmina.lat' 'Szerokość' 'Szerokość geogr.')); Size = @((New-Proj $mKis 'kis_country.KIS' 'KIS' 'KIS')) }),
            (New-DataVisual 'v_p1_kis_gminy' 'clusteredBarChart' 'Top gminy wg KIS' 20 425 800 240 @{ Category = @((New-Proj (New-Col 'dim_gmina' 'gmina_name') 'dim_gmina.gmina_name' 'Gmina' 'Gmina')); Y = @((New-Proj $mKis 'kis_country.KIS' 'KIS' 'KIS')) } $mKis)
        )
        'wojewodztwo-gminy' = @(
            (New-TextboxVisual 'v_p2_title' 'Województwo i gminy — drill-down administracyjny' 20 15 900 45),
            (New-DataVisual 'v_p2_slicer_voiv' 'slicer' 'Filtr województwa' 20 70 260 170 @{ Values = @((New-Proj (New-Col 'dim_voivodeship' 'voivodeship_name') 'dim_voivodeship.voivodeship_name' 'Województwo' 'Województwo')) }),
            (New-DataVisual 'v_p2_table_gminy' 'tableEx' 'Gminy z KIS i skutkami' 300 70 450 595 @{ Values = @((New-Proj (New-Col 'dim_gmina' 'gmina_name') 'dim_gmina.gmina_name' 'Gmina' 'Gmina'), (New-Proj $mKis 'kis_country.KIS' 'KIS' 'KIS'), (New-Proj $mKisMax 'kis_country.KIS Max Lokalny' 'KIS Max Lokalny' 'KIS max'), (New-Proj $mAffected 'kis_country.Osoby Dotkniete' 'Osoby Dotkniete' 'Osoby dotknięte')) }),
            (New-DataVisual 'v_p2_top15_kis' 'clusteredBarChart' 'Top 15 gmin wg KIS' 770 70 490 280 @{ Category = @((New-Proj (New-Col 'dim_gmina' 'gmina_name') 'dim_gmina.gmina_name' 'Gmina' 'Gmina')); Y = @((New-Proj $mKis 'kis_country.KIS' 'KIS' 'KIS')) } $mKis),
            (New-DataVisual 'v_p2_hydro_line' 'lineChart' 'Poziomy wody w czasie' 770 375 490 290 @{ Category = @((New-Proj (New-Col 'hydro_readings' 'timestamp') 'hydro_readings.timestamp' 'Czas' 'Czas')); Y = @((New-Proj $sumHydro 'Average(hydro_readings.level_cm)' 'Średni poziom wody' 'Średni poziom wody')) }),
            (New-DataVisual 'v_p2_alarm_card' 'card' 'Wodowskazy w alarmie' 20 270 260 110 @{ Values = @((New-Proj $mAlarm 'kis_country.Alarm Hydro' 'Alarm Hydro' 'Alarm hydro')) })
        )
        'infrastruktura-krytyczna' = @(
            (New-TextboxVisual 'v_p3_title' 'Infrastruktura krytyczna — energia, łączność, kaskady' 20 15 1000 45),
            (New-DataVisual 'v_p3_power_time' 'lineChart' 'Odbiorcy bez prądu w czasie' 20 80 600 270 @{ Category = @((New-Proj (New-Col 'power_grid_events' 'timestamp') 'power_grid_events.timestamp' 'Czas' 'Czas')); Y = @((New-Proj $sumPower 'Sum(power_grid_events.customers_offline)' 'Odbiorcy bez prądu' 'Odbiorcy bez prądu')) }),
            (New-DataVisual 'v_p3_telco_gminy' 'clusteredBarChart' 'Gminy z ograniczoną łącznością' 650 80 590 270 @{ Category = @((New-Proj (New-Col 'telecom_events' 'gmina_code') 'telecom_events.gmina_code' 'Gmina' 'Gmina')); Y = @((New-Proj $sumBase 'Sum(telecom_events.base_stations_down)' 'Stacje wyłączone' 'Stacje wyłączone')) } $sumBase),
            (New-DataVisual 'v_p3_power_gminy' 'clusteredColumnChart' 'Awaria energii wg gmin' 20 380 600 285 @{ Category = @((New-Proj (New-Col 'power_grid_events' 'gmina_code') 'power_grid_events.gmina_code' 'Gmina' 'Gmina')); Y = @((New-Proj $sumPower 'Sum(power_grid_events.customers_offline)' 'Odbiorcy bez prądu' 'Odbiorcy bez prądu')) } $sumPower),
            (New-DataVisual 'v_p3_correlation' 'tableEx' 'Korelacja awarii: energia i łączność' 650 380 590 285 @{ Values = @((New-Proj (New-Col 'telecom_events' 'gmina_code') 'telecom_events.gmina_code' 'Gmina' 'Gmina'), (New-Proj $sumBase 'Sum(telecom_events.base_stations_down)' 'Stacje wyłączone' 'Stacje wyłączone'), (New-Proj $mPower 'kis_country.Odbiorcy Bez Prądu' 'Odbiorcy Bez Prądu' 'Odbiorcy bez prądu')) })
        )
        'eskalacja-spo' = @(
            (New-TextboxVisual 'v_p4_title' 'Eskalacja i SPO — rekomendacje dla RZZK' 20 15 900 45),
            (New-DataVisual 'v_p4_reco_table' 'tableEx' 'Rekomendacje eskalacji' 20 80 610 360 @{ Values = @((New-Proj (New-Col 'escalation_recommendations' 'gmina_code') 'escalation_recommendations.gmina_code' 'Gmina' 'Gmina'), (New-Proj (New-Col 'escalation_recommendations' 'recommended_level') 'escalation_recommendations.recommended_level' 'Poziom' 'Poziom'), (New-Proj (New-Col 'escalation_recommendations' 'recommended_spo') 'escalation_recommendations.recommended_spo' 'SPO' 'SPO'), (New-Proj (New-Col 'escalation_recommendations' 'explanation') 'escalation_recommendations.explanation' 'Uzasadnienie' 'Uzasadnienie')) }),
            (New-DataVisual 'v_p4_spo_bar' 'clusteredColumnChart' 'Uruchomione SPO' 660 80 580 220 @{ Category = @((New-Proj (New-Col 'escalation_events' 'recommended_spo') 'escalation_events.recommended_spo' 'SPO' 'SPO')); Y = @((New-Proj $countEsc 'Count(escalation_events.event_id)' 'Liczba eskalacji' 'Liczba eskalacji')) } $countEsc),
            (New-DataVisual 'v_p4_resources' 'clusteredBarChart' 'Zaangażowane siły i środki' 660 330 580 335 @{ Category = @((New-Proj (New-Col 'resource_deployment' 'voivodeship_code') 'resource_deployment.voivodeship_code' 'Województwo' 'Województwo')); Y = @((New-Proj $mPsp 'kis_country.PSP Zastepy' 'PSP Zastepy' 'PSP zastępy'), (New-Proj $mWot 'kis_country.WOT Zolnierze' 'WOT Zolnierze' 'WOT żołnierze'), (New-Proj $mPumps 'kis_country.Pompy' 'Pompy' 'Pompy')) }),
            (New-DataVisual 'v_p4_rzzk_card' 'card' 'Rekomendacje RZZK' 20 470 290 95 @{ Values = @((New-Proj $mRzzk 'kis_country.Rekomendacje RZZK' 'Rekomendacje RZZK' 'Rekomendacje RZZK')) }),
            (New-DataVisual 'v_p4_kis_card' 'card' 'Maksymalny KIS lokalny' 340 470 290 95 @{ Values = @((New-Proj $mKisMax 'kis_country.KIS Max Lokalny' 'KIS Max Lokalny' 'KIS max lokalny')) })
        )
    }

    foreach ($pageId in $pageIds) {
        foreach ($v in @($visuals[$pageId])) {
            $json = $v | ConvertTo-Json -Depth 100
            $visualName = $v.name
            $parts.Add((New-Part "definition/pages/$pageId/visuals/$visualName/visual.json" $json))
            Save-DefinitionPart $ReportOutRoot "definition\pages\$pageId\visuals\$visualName\visual.json" $json
        }
    }

    return @{ format = 'PBIR'; parts = @($parts) }
}

function Upsert-Report([hashtable]$Headers, [string]$SemanticModelId) {
    $reportScript = Join-Path $PSScriptRoot 'create_report.ps1'
    if (-not (Test-Path $reportScript)) { throw "Brak skryptu raportu: $reportScript" }
    & $reportScript `
        -WorkspaceId $WorkspaceId `
        -SemanticModelId $SemanticModelId `
        -ReportId 'a0449186-59df-49f4-a151-9ceceb06726e' `
        -ReportName $ReportName | Out-Null
    Start-Sleep -Seconds 3
    $report = Find-Item -Headers $Headers -DisplayName $ReportName -Type 'Report'
    if (-not $report) { throw "Raport $ReportName nie pojawił się na liście elementów po wdrożeniu." }
    return $report
}

function Get-DefinitionStats([hashtable]$Headers, [string]$ItemId, [string]$Format) {
    $uri = "https://api.fabric.microsoft.com/v1/workspaces/$WorkspaceId/items/$ItemId/getDefinition"
    if ($Format) { $uri += "?format=$Format" }
    $resp = Invoke-FabricJson -Method POST -Uri $uri -Headers $Headers -Body @{}
    if ([int]$resp.StatusCode -eq 202) {
        $location = @($resp.Headers.Location) | Select-Object -First 1
        do {
            Start-Sleep -Seconds 3
            $op = Invoke-FabricJson -Method GET -Uri $location -Headers $Headers
            $body = if ($op.Content) { $op.Content | ConvertFrom-Json } else { $null }
            $status = $body.status
            $nextLocation = @($op.Headers.Location) | Select-Object -First 1
            if ($nextLocation) { $location = $nextLocation }
            if ($status -eq 'Failed') { throw "getDefinition failed: $($body.error.errorCode) $($body.error.message)" }
        } while ($status -in @('Running','NotStarted'))
        $result = Invoke-FabricJson -Method GET -Uri $location -Headers $Headers
        if (-not $result.Content) { return $null }
        return $result.Content | ConvertFrom-Json
    }
    if (-not $resp.Content) { return $null }
    return $resp.Content | ConvertFrom-Json
}

# Direct Lake nie przeladowuje danych po updateDefinition - model dalej pokazuje
# stan z poprzedniego framingu, nawet gdy pliki w OneLake i tabele Delta sa nowe.
# Jawny refresh typu DirectLakeFraming przestawia model na aktualne wersje Delta.
function Invoke-DirectLakeReframe([string]$SemanticModelId) {
    $pbiToken = Get-AccessToken 'https://analysis.windows.net/powerbi/api'
    $headers = New-AuthHeaders $pbiToken
    $base = "https://api.powerbi.com/v1.0/myorg/groups/$WorkspaceId/datasets/$SemanticModelId"
    Invoke-FabricJson -Method POST -Uri "$base/refreshes" -Headers $headers -Body @{ type = 'full' } | Out-Null

    $deadline = (Get-Date).AddMinutes(10)
    do {
        Start-Sleep -Seconds 10
        $last = ((Invoke-FabricJson -Method GET -Uri "$base/refreshes?`$top=1" -Headers $headers).Content | ConvertFrom-Json).value[0]
        if ((Get-Date) -gt $deadline) { throw 'Reframe Direct Lake przekroczyl limit 10 minut.' }
    } while ($last.status -eq 'Unknown')

    if ($last.status -ne 'Completed') { throw "Reframe Direct Lake zakonczyl sie statusem $($last.status)." }
    Write-Host "Direct Lake przeframowany ($($last.refreshType))."
}

function Invoke-DaxCheck([string]$SemanticModelId) {
    $pbiToken = Get-AccessToken 'https://analysis.windows.net/powerbi/api'
    $headers = New-AuthHeaders $pbiToken
    $body = @{
        queries = @(@{ query = 'EVALUATE ROW("n", COUNTROWS(dim_gmina))' })
        serializerSettings = @{ includeNulls = $true }
    }
    $uri = "https://api.powerbi.com/v1.0/myorg/datasets/$SemanticModelId/executeQueries"
    $resp = Invoke-FabricJson -Method POST -Uri $uri -Headers $headers -Body $body
    return $resp.Content | ConvertFrom-Json
}

$fabricToken = Get-AccessToken 'https://api.fabric.microsoft.com'
$headers = New-AuthHeaders $fabricToken
$lakeProps = Get-LakehouseProperties $headers
Write-Host "Workspace: $WorkspaceName ($WorkspaceId)"
Write-Host "Lakehouse: $LakehouseName ($LakehouseId)"
Write-Host "SQL endpoint: $($lakeProps.sqlEndpointProperties.connectionString)"

$semantic = Upsert-SemanticModel $headers
Write-Host "Model semantyczny: $($semantic.displayName) id=$($semantic.id)"
Invoke-DirectLakeReframe $semantic.id

$report = $null
if (-not $SkipReport) {
    $report = Upsert-Report -Headers $headers -SemanticModelId $semantic.id
    Write-Host "Raport: $($report.displayName) id=$($report.id)"
}

Start-Sleep -Seconds 10
$items = Get-Items $headers
$models = @($items.value | Where-Object type -eq 'SemanticModel')
$reports = @($items.value | Where-Object type -eq 'Report')
$semDef = Get-DefinitionStats -Headers $headers -ItemId $semantic.id -Format 'TMDL'
$semParts = @($semDef.definition.parts)
$tableCount = @($semParts | Where-Object { $_.path -like 'definition/tables/*.tmdl' }).Count
$relPart = @($semParts | Where-Object { $_.path -eq 'definition/relationships.tmdl' }) | Select-Object -First 1
$relCount = 0
if ($relPart) {
    $relText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($relPart.payload))
    $relCount = ([regex]::Matches($relText, '(?m)^relationship\s+')).Count
}
$measureCount = 0
foreach ($p in @($semParts | Where-Object { $_.path -like 'definition/tables/*.tmdl' })) {
    $txt = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p.payload))
    $measureCount += ([regex]::Matches($txt, '(?m)^\s*measure\s+')).Count
}
$pageCount = 0
$visualCount = 0
if ($report) {
    try {
        $repDef = Get-DefinitionStats -Headers $headers -ItemId $report.id -Format 'PBIR'
    }
    catch {
        $repDef = Get-DefinitionStats -Headers $headers -ItemId $report.id -Format ''
    }
    if ($repDef) {
        $pageCount = @($repDef.definition.parts | Where-Object { $_.path -match '^definition/pages/.+/page\.json$' }).Count
        $visualCount = @($repDef.definition.parts | Where-Object { $_.path -match '^definition/pages/.+/visuals/.+/visual\.json$' }).Count
        if ($pageCount -eq 0) {
            $legacyPart = @($repDef.definition.parts | Where-Object { $_.path -eq 'report.json' }) | Select-Object -First 1
            if ($legacyPart) {
                $legacyText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($legacyPart.payload))
                $legacySections = @(($legacyText | ConvertFrom-Json).sections)
                $pageCount = $legacySections.Count
                $visualCount = @($legacySections | ForEach-Object { $_.visualContainers }).Count
            }
        }
    }
}

$daxResult = $null
try {
    $daxResult = Invoke-DaxCheck $semantic.id
    $row = $daxResult.results[0].tables[0].rows[0]
    $n = $row.PSObject.Properties['[n]'].Value
    if ($null -eq $n) { $n = $row.n }
    Write-Host "DAX OK: COUNTROWS(dim_gmina) = $n"
}
catch {
    Write-Warning "Weryfikacja DAX nie powiodła się: $($_.Exception.Message)"
}

[pscustomobject]@{
    SemanticModelId = $semantic.id
    ReportId = if ($report) { $report.id } else { $null }
    DirectLake = $true
    Tables = $tableCount
    Relationships = $relCount
    Measures = $measureCount
    ReportPages = $pageCount
    ReportVisuals = $visualCount
    DaxCountRowsDimGmina = if ($daxResult) { $daxResult.results[0].tables[0].rows[0].PSObject.Properties['[n]'].Value } else { $null }
    LocalSemanticDefinition = $OutRoot
    LocalReportDefinition = $ReportOutRoot
    SemanticModelsInWorkspace = @($models).Count
    ReportsInWorkspace = @($reports).Count
} | ConvertTo-Json -Depth 10
