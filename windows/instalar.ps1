#Requires -RunAsAdministrator
<#
  Instala a Forense Wordle League numa máquina Windows (sem Docker).

  Uso (PowerShell como Administrador, dentro da pasta da aplicação):
    powershell -ExecutionPolicy Bypass -File .\windows\instalar.ps1
    powershell -ExecutionPolicy Bypass -File .\windows\instalar.ps1 -Porta 8080

  O que faz:
    1. verifica o Node.js (22.9 ou superior);
    2. instala as dependências (npm ci);
    3. cria o ficheiro .env (se ainda não existir);
    4. cria a conta de administrador (opcional, interativo);
    5. abre a porta na firewall do Windows (redes de domínio e privadas);
    6. regista a tarefa "ForenseWordleLeague" (arranca com o Windows e reinicia se falhar);
    7. regista a tarefa de backup diário (03:00, guarda 30 dias);
    8. inicia a aplicação e confirma que responde.
#>
param(
  [int]$Porta = 3000,
  [string]$NomeTarefa = 'ForenseWordleLeague'
)

$ErrorActionPreference = 'Stop'
$App = Split-Path -Parent $PSScriptRoot
Set-Location $App

function Passo([string]$Texto) { Write-Host "`n==> $Texto" -ForegroundColor Cyan }
function Ok([string]$Texto) { Write-Host "    $Texto" -ForegroundColor Green }
function Aviso([string]$Texto) { Write-Host "    $Texto" -ForegroundColor Yellow }

if ($App -like "$env:USERPROFILE*") {
  Aviso "A aplicação está dentro da pasta do utilizador ($App)."
  Aviso 'Recomenda-se uma pasta fixa, por exemplo C:\ForenseWordleLeague.'
}

# 1. Node.js -------------------------------------------------------------------
Passo 'A verificar o Node.js'
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  throw 'Node.js não encontrado. Instale o Node.js 24 LTS (https://nodejs.org) e execute este script numa NOVA janela do PowerShell.'
}
$nodeExe = $nodeCmd.Source
$versao = (& $nodeExe -v).Trim().TrimStart('v')
$partes = $versao.Split('.')
if ([int]$partes[0] -lt 22 -or ([int]$partes[0] -eq 22 -and [int]$partes[1] -lt 9)) {
  throw "Node.js $versao é demasiado antigo. É necessária a versão 22.9 ou superior (recomendada: 24 LTS)."
}
Set-Content -Path (Join-Path $PSScriptRoot 'node-path.txt') -Value $nodeExe -Encoding ASCII
Ok "Node.js $versao ($nodeExe)"

# 2. Dependências ----------------------------------------------------------------
Passo 'A instalar as dependências (npm ci)'
$npm = Join-Path (Split-Path $nodeExe) 'npm.cmd'
& $npm ci --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) {
  throw 'npm ci falhou. Confirme o acesso à Internet (registry.npmjs.org e github.com) ou um proxy configurado (npm config set proxy ...).'
}
Ok 'Dependências instaladas.'

# 3. Configuração ----------------------------------------------------------------
Passo 'A preparar a configuração (.env)'
$envFile = Join-Path $App '.env'
if (Test-Path $envFile) {
  Aviso '.env já existe: mantido sem alterações.'
  $linhaPorta = Select-String -Path $envFile -Pattern '^PORT=(\d+)' | Select-Object -First 1
  if ($linhaPorta) { $Porta = [int]$linhaPorta.Matches[0].Groups[1].Value }
} else {
  $texto = Get-Content (Join-Path $App '.env.example') -Raw -Encoding UTF8
  $texto = $texto -replace '(?m)^APP_PORT=.*$', "APP_PORT=$Porta"
  $texto = $texto -replace '(?m)^PORT=.*$', "PORT=$Porta"
  $texto = $texto -replace '(?m)^NODE_ENV=.*$', 'NODE_ENV=production'
  $texto = $texto -replace '(?m)^LOG_REQUESTS=.*$', 'LOG_REQUESTS=false'
  [IO.File]::WriteAllText($envFile, $texto, (New-Object Text.UTF8Encoding $false))
  Ok ".env criado (porta $Porta). O segredo das sessões é gerado automaticamente no primeiro arranque."
}
New-Item -ItemType Directory -Force -Path (Join-Path $App 'data\logs') | Out-Null

# 4. Administrador ---------------------------------------------------------------
Passo 'Conta de administrador'
$resp = Read-Host '    Criar agora uma conta de administrador? (S/N)'
if ($resp -match '^[sS]') {
  & $nodeExe --env-file-if-exists=.env scripts\create-admin.js
  if ($LASTEXITCODE -ne 0) { Aviso 'A conta não foi criada. Pode repetir mais tarde: npm run create-admin' }
} else {
  Aviso 'Ignorado. Pode criar mais tarde com: npm run create-admin'
}

# 5. Firewall -------------------------------------------------------------------
Passo "A abrir a porta $Porta na firewall"
$regra = 'Forense Wordle League'
Get-NetFirewallRule -DisplayName $regra -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $regra -Direction Inbound -Protocol TCP -LocalPort $Porta -Action Allow -Profile Domain, Private | Out-Null
Ok "Regra '$regra' criada (perfis Domínio e Privado)."

# 6. Tarefa de arranque -----------------------------------------------------------
Passo "A registar a tarefa '$NomeTarefa'"
$acao = New-ScheduledTaskAction -Execute (Join-Path $PSScriptRoot 'run-server.cmd') -WorkingDirectory $App
$gatilho = New-ScheduledTaskTrigger -AtStartup
$conta = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$opcoes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $NomeTarefa -Action $acao -Trigger $gatilho -Principal $conta -Settings $opcoes `
  -Description 'Forense Wordle League (servidor Node.js)' -Force | Out-Null
Ok 'Arranca automaticamente com o Windows e reinicia em caso de falha.'

# 7. Backup diário ----------------------------------------------------------------
Passo 'A registar o backup diário (03:00)'
$acaoBk = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'backup.ps1')`"" -WorkingDirectory $App
$gatilhoBk = New-ScheduledTaskTrigger -Daily -At 3am
$opcoesBk = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "$NomeTarefa-Backup" -Action $acaoBk -Trigger $gatilhoBk -Principal $conta -Settings $opcoesBk `
  -Description 'Backup diário da base de dados da Forense Wordle League' -Force | Out-Null
Ok 'Backups em data\backups (mantidos 30 dias).'

# 8. Arranque ---------------------------------------------------------------------
Passo 'A iniciar a aplicação'
& (Join-Path $PSScriptRoot 'servico.ps1') -Acao reiniciar -NomeTarefa $NomeTarefa
$ok = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Porta/api/health" -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch { }
}
if (-not $ok) { throw 'A aplicação não respondeu. Consulte data\logs\server.log' }

$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress
Write-Host "`nInstalação concluída." -ForegroundColor Green
Write-Host "  Neste computador:  http://localhost:$Porta"
Write-Host "  Na rede:           http://$($env:COMPUTERNAME):$Porta"
foreach ($ip in $ips) { Write-Host "                     http://$($ip):$Porta" }
Write-Host "  Classificação:     http://$($env:COMPUTERNAME):$Porta/ranking"
Write-Host "`nPróximo passo: entrar como administrador e importar as listas de palavras em Admin -> Palavras."
Write-Host "(As listas reais não vêm no repositório; coloque-as na pasta listas\ ou importe-as de onde as tiver.)"
