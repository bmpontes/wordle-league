#Requires -RunAsAdministrator
<#
  Remove as tarefas agendadas e a regra de firewall.
  NÃO apaga a pasta da aplicação, a base de dados (data\) nem o .env.
    powershell -ExecutionPolicy Bypass -File .\windows\desinstalar.ps1
#>
param([string]$NomeTarefa = 'ForenseWordleLeague')

$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'servico.ps1') -Acao parar -NomeTarefa $NomeTarefa
foreach ($t in @($NomeTarefa, "$NomeTarefa-Backup")) {
  if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $t -Confirm:$false
    Write-Host "Tarefa '$t' removida."
  }
}
Get-NetFirewallRule -DisplayName 'Forense Wordle League' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host 'Regra de firewall removida.'
Write-Host 'Os dados (pasta data\) foram mantidos.'
