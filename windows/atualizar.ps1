#Requires -RunAsAdministrator
<#
  Aplica uma nova versão da aplicação.
  1. Copie os ficheiros novos POR CIMA desta pasta (não apague data\ nem .env).
  2. Execute: powershell -ExecutionPolicy Bypass -File .\windows\atualizar.ps1
  Faz backup, para a aplicação, reinstala as dependências e volta a iniciar
  (as migrações da base de dados são aplicadas automaticamente no arranque).
#>
param([string]$NomeTarefa = 'ForenseWordleLeague')

$ErrorActionPreference = 'Stop'
$App = Split-Path -Parent $PSScriptRoot
Set-Location $App

Write-Host '==> Backup antes da atualização' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'backup.ps1')

Write-Host '==> A parar' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'servico.ps1') -Acao parar -NomeTarefa $NomeTarefa

Write-Host '==> A instalar dependências' -ForegroundColor Cyan
$nodeExe = (Get-Content (Join-Path $PSScriptRoot 'node-path.txt') -Raw).Trim()
& (Join-Path (Split-Path $nodeExe) 'npm.cmd') ci --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm ci falhou. A aplicação continua parada; corrija e volte a executar.' }

Write-Host '==> A iniciar' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'servico.ps1') -Acao iniciar -NomeTarefa $NomeTarefa
Start-Sleep -Seconds 4
& (Join-Path $PSScriptRoot 'servico.ps1') -Acao estado -NomeTarefa $NomeTarefa
