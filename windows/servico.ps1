<#
  Controlo do Wordle League instalada como tarefa do Windows.

  powershell -ExecutionPolicy Bypass -File .\windows\servico.ps1 -Acao estado
  Ações: iniciar | parar | reiniciar | estado | registo
  (iniciar/parar/reiniciar exigem PowerShell como Administrador)
#>
param(
  [ValidateSet('iniciar', 'parar', 'reiniciar', 'estado', 'registo')]
  [string]$Acao = 'estado',
  [string]$NomeTarefa = 'ForenseWordleLeague'
)

$ErrorActionPreference = 'Stop'
$App = Split-Path -Parent $PSScriptRoot

function Processos-Servidor {
  # Processos node.exe desta aplicação (a tarefa termina o cmd.exe, mas não necessariamente o node).
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like '*src\server.js*' }
}

function Parar {
  $t = Get-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue
  if ($t) { Stop-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue }
  foreach ($p in Processos-Servidor) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  Write-Host 'Aplicação parada.'
}

function Iniciar {
  if (-not (Get-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue)) {
    throw "Tarefa '$NomeTarefa' não encontrada. Execute primeiro windows\instalar.ps1."
  }
  Start-ScheduledTask -TaskName $NomeTarefa
  Write-Host 'Aplicação iniciada.'
}

switch ($Acao) {
  'iniciar'   { Iniciar }
  'parar'     { Parar }
  'reiniciar' { Parar; Iniciar }
  'estado' {
    $t = Get-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue
    if (-not $t) { Write-Host "Tarefa '$NomeTarefa' não instalada."; break }
    $info = Get-ScheduledTaskInfo -TaskName $NomeTarefa
    Write-Host "Tarefa:          $($t.State)"
    Write-Host "Última execução: $($info.LastRunTime) (resultado $($info.LastTaskResult))"
    $procs = @(Processos-Servidor)
    Write-Host "Processo node:   $(if ($procs.Count) { 'a correr (PID ' + ($procs.ProcessId -join ', ') + ')' } else { 'não está a correr' })"
    $porta = 3000
    $linha = Select-String -Path (Join-Path $App '.env') -Pattern '^PORT=(\d+)' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($linha) { $porta = [int]$linha.Matches[0].Groups[1].Value }
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$porta/api/health" -TimeoutSec 3
      Write-Host "HTTP:            a responder em http://localhost:$porta ($($r.StatusCode))" -ForegroundColor Green
    } catch {
      Write-Host "HTTP:            sem resposta na porta $porta" -ForegroundColor Red
    }
  }
  'registo' {
    $log = Join-Path $App 'data\logs\server.log'
    if (Test-Path $log) { Get-Content $log -Tail 50 -Encoding UTF8 } else { Write-Host 'Ainda não existe registo.' }
  }
}
