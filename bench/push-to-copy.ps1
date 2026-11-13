# Pushes the app plus the capacity-benchmark files to a SEPARATE test Apps Script project.
# Usage (PowerShell, from the repository root):
#   .\bench\push-to-copy.ps1 -ScriptId <script ID of the BENCH spreadsheet's Apps Script project>
#
# It never touches this repository's .clasp.json: it builds a temporary folder with its own .clasp.json
# and pushes from there. It refuses any script ID that appears in a .clasp.json* file of this repository
# (the live clubs).
param([Parameter(Mandatory = $true)][string]$ScriptId)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$liveIds = Get-ChildItem -Path $root -Filter '.clasp.json*' -File | ForEach-Object {
  try { (Get-Content $_.FullName -Raw | ConvertFrom-Json).scriptId } catch { $null }
} | Where-Object { $_ }
if ($liveIds -contains $ScriptId) { throw "Refusing: $ScriptId is a live club's script (listed in a .clasp.json file of this repository)." }

$dir = Join-Path $env:TEMP ("sacco-bench-" + $ScriptId.Substring(0, 12))
if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
New-Item -ItemType Directory -Force (Join-Path $dir 'src\zz_bench') | Out-Null
Copy-Item (Join-Path $root 'appsscript.json') $dir
Copy-Item -Recurse (Join-Path $root 'src\*') (Join-Path $dir 'src')
Copy-Item (Join-Path $root 'bench\gas\*.gs') (Join-Path $dir 'src\zz_bench')
@{ scriptId = $ScriptId; rootDir = ''; scriptExtensions = @('.js', '.gs'); htmlExtensions = @('.html'); jsonExtensions = @('.json');
   filePushOrder = @(); skipSubdirectories = $false } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $dir '.clasp.json')

Push-Location $dir
try { clasp push --force } finally { Pop-Location }
Write-Host "Pushed to the bench copy from $dir. Open the copy's Apps Script editor and run benchInit()."
