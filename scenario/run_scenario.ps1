<#
.SYNOPSIS
    Uruchamia scenariusz logistyczny od zera i zasila Eventhouse w czasie rzeczywistym.

.DESCRIPTION
    Skrypt jest idempotentny: kazde uruchomienie z domyslnym resetem czysci tabele
    strumieniowe, laduje tlo scenariusza ingestia wsadowa i odtwarza okno live
    strumieniowo. Znaczniki czasu sa przypinane do biezacego zegara, wiec dashboard
    pokazuje swieze dane niezaleznie od pory uruchomienia.

    Scena: powodz wrzesniowa, faza dystrybucji zasobow. Dane obejmuja 15-26.09.2026,
    szczyt operacji transportowych przypada na 19-20.09 i to okno jest odtwarzane live.

.PARAMETER Preset
    demo       - 24 h akcji w ok. 24 min (minuta scenariusza na sekunde) - domyslny
    szybki     - 24 h akcji w ok. 5 min; smoke-test, nie do prezentacji, bo caly cykl
                 miesci sie w oknie dashboardu i przyrost nie jest widoczny
    kulminacja - doba szczytu transportow (20.09) w ok. 24 min
    wolny      - 12 h akcji w ok. 48 min, do prezentacji w tle
    ciagly     - scenariusz zapetla sie bez konca; dashboard jest na zywo o kazdej porze

.PARAMETER Background
    Uruchamia odtwarzanie jako proces w tle, PID w scenario\_ciagly.pid,
    log w scenario\_ciagly.log. Wlasciwe dla trybu ciaglego.

.PARAMETER Stop
    Zatrzymuje proces zapisany w scenario\_ciagly.pid.

.PARAMETER NoReset
    Nie czysci tabel i nie laduje tla; dokleja okno live do istniejacych danych.

.PARAMETER ResetOnly
    Tylko czysci tabele strumieniowe i konczy prace.

.PARAMETER TimeMode
    wall   - domyslny: scena skompresowana tempem i przypieta do biezacego zegara.
             Tylko ten tryb daje efekt czasu rzeczywistego w oknie "ostatnie 15 minut".
    source - oryginalne znaczniki scenariusza (wrzesien 2026)
    now    - staly offset tak, by scena zaczynala sie w chwili uruchomienia

.EXAMPLE
    .\scenario\run_scenario.ps1
.EXAMPLE
    .\scenario\run_scenario.ps1 -Preset ciagly -Background
.EXAMPLE
    .\scenario\run_scenario.ps1 -ResetOnly
#>
[CmdletBinding()]
param(
    [ValidateSet('demo', 'szybki', 'kulminacja', 'wolny', 'ciagly')]
    [string]$Preset = 'demo',
    [switch]$NoReset,
    [switch]$ResetOnly,
    [ValidateSet('wall', 'source', 'now')]
    [string]$TimeMode = 'wall',
    [double]$Speed,
    [string]$Streams,
    [switch]$Background,
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $PSScriptRoot '_ciagly.pid'
$logFile = Join-Path $PSScriptRoot '_ciagly.log'
$errFile = Join-Path $PSScriptRoot '_ciagly.err.log'
$workspaceId = 'aebf1df2-3be8-4f89-9d8d-647ae519d50b'

function Stop-Replay {
    if (-not (Test-Path $pidFile)) { Write-Host 'Brak zapisanego procesu odtwarzania.'; return }
    $existing = Get-Content $pidFile
    $proc = Get-Process -Id $existing -ErrorAction SilentlyContinue
    if ($proc) { Stop-Process -Id $existing -Force; Write-Host "Zatrzymano odtwarzanie (PID $existing)." }
    else { Write-Host "Proces $existing juz nie dziala." }
    Remove-Item $pidFile -Force
}

if ($Stop) { Stop-Replay; return }

$presets = @{
    demo       = @{ Speed = 60;  LiveHours = 24; From = $null }
    szybki     = @{ Speed = 300; LiveHours = 24; From = $null }
    kulminacja = @{ Speed = 30;  LiveHours = 12; From = '2026-09-20T00:00:00+02:00' }
    wolny      = @{ Speed = 15;  LiveHours = 12; From = $null }
    ciagly     = @{ Speed = 60;  LiveHours = 24; From = $null; Loop = $true }
}
$selected = $presets[$Preset]
if ($PSBoundParameters.ContainsKey('Speed')) { $selected.Speed = $Speed }

Write-Host '=== Scenariusz: dystrybucja zasobow w powodzi wrzesniowej' -ForegroundColor Cyan
Write-Host "  wariant:   $Preset"
Write-Host "  tempo:     $($selected.Speed)x czasu rzeczywistego"
Write-Host "  okno live: $($selected.LiveHours) h scenariusza"
Write-Host "  znaczniki: $TimeMode"

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { throw 'Brak python w PATH.' }

$argv = @('-u', (Join-Path $PSScriptRoot 'replay.py'), '--speed', $selected.Speed,
          '--live-hours', $selected.LiveHours, '--time-mode', $TimeMode)
if (-not $NoReset) { $argv += @('--reset', '--bulk') }
if ($ResetOnly) { $argv += @('--reset', '--reset-only') }
if ($selected.From) { $argv += @('--from', $selected.From) }
if ($selected.Loop) { $argv += '--loop' }
if ($Streams) { $argv += @('--streams', $Streams) }

Push-Location $repo
try {
    if ($Background) {
        Stop-Replay
        $proc = Start-Process -FilePath $python.Source -ArgumentList $argv -PassThru `
            -RedirectStandardOutput $logFile -RedirectStandardError $errFile -WindowStyle Hidden
        $proc.Id | Set-Content $pidFile
        Write-Host "Odtwarzanie w tle, PID $($proc.Id). Log: $logFile" -ForegroundColor Green
        Write-Host 'Zatrzymanie: .\scenario\run_scenario.ps1 -Stop'
    }
    else {
        & $python.Source @argv
        if ($LASTEXITCODE -ne 0) { throw "replay.py zakonczyl sie kodem $LASTEXITCODE" }
    }
}
finally {
    Pop-Location
}

if (-not $ResetOnly -and -not $Background) {
    Write-Host ''
    Write-Host "Dashboard: https://app.fabric.microsoft.com/groups/$workspaceId" -ForegroundColor Green
    Write-Host 'Wskazowka: wlacz auto-odswiezanie na dashboardzie, aby widziec naplyw zdarzen.'
}
