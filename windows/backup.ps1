<#
  Backup da base de dados (pode correr com a aplicação ligada).
  Usado pela tarefa diária; também pode ser executado à mão:
    powershell -ExecutionPolicy Bypass -File .\windows\backup.ps1
    powershell -ExecutionPolicy Bypass -File .\windows\backup.ps1 -CopiarPara \\servidor\partilha\wordle
#>
param(
  [int]$ManterDias = 30,
  [string]$CopiarPara = ''
)

$ErrorActionPreference = 'Stop'
$App = Split-Path -Parent $PSScriptRoot
Set-Location $App

$nodeExe = 'node'
$cfg = Join-Path $PSScriptRoot 'node-path.txt'
if (Test-Path $cfg) { $nodeExe = (Get-Content $cfg -Raw).Trim() }

$saida = & $nodeExe --env-file-if-exists=.env scripts\backup.js 2>&1
$saida | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) { exit 1 }

$pasta = Join-Path $App 'data\backups'
if ($CopiarPara) {
  $ultimo = Get-ChildItem $pasta -Filter 'wordle-*.sqlite' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($ultimo) {
    Copy-Item $ultimo.FullName -Destination $CopiarPara
    Write-Host "Copiado para $CopiarPara"
  }
}

Get-ChildItem $pasta -Filter 'wordle-*.sqlite' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$ManterDias) } |
  Remove-Item -Force
