<#
.SYNOPSIS
  Agenda o atualizar_dados_tv.ps1 no Agendador de Tarefas do Windows.

.DESCRIPTION
  Cria (ou recria) a tarefa "Painel Entregas - atualizar dados", que roda o
  script a cada N minutos, de segunda a sábado, das 6h às 20h, com o usuário
  logado (assim ela enxerga a pasta do OneDrive/SharePoint).

  Parâmetros extras (ex.: modo consulta ao SAP) vão em -ArgumentosExtras.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File agendar_atualizacao.ps1

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File agendar_atualizacao.ps1 -IntervaloMinutos 10 `
    -ArgumentosExtras '-Banco SqlServer -ConexaoSql "Server=SRV-SAP;Database=SBO_APIS;Integrated Security=True" -ConsultaPedido consulta_pedido.sql -ConsultaRecebimento consulta_recebimento.sql'
#>
param(
  [int]$IntervaloMinutos = 15,
  [string]$Inicio = "06:00",
  [int]$HorasPorDia = 14,
  [string]$ArgumentosExtras = ""
)
$ErrorActionPreference = "Stop"
$nome = "Painel Entregas - atualizar dados"
$script = Join-Path $PSScriptRoot "atualizar_dados_tv.ps1"
if (-not (Test-Path $script)) { throw "Não encontrei $script" }

$argumentos = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" $ArgumentosExtras"
$acao = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argumentos -WorkingDirectory $PSScriptRoot
$gatilho = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday,Saturday -At $Inicio
$repeticao = New-ScheduledTaskTrigger -Once -At $Inicio -RepetitionInterval (New-TimeSpan -Minutes $IntervaloMinutos) -RepetitionDuration (New-TimeSpan -Hours $HorasPorDia)
$gatilho.Repetition = $repeticao.Repetition
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

if (Get-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $nome -Confirm:$false
}
Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho -Settings $config `
  -Description "Gera dados\entregas_dados.js para o painel de entregas da TV." | Out-Null

Write-Host "Tarefa '$nome' criada: a cada $IntervaloMinutos min, seg a sáb, das $Inicio por $HorasPorDia h."
Write-Host "Para rodar agora: Start-ScheduledTask -TaskName '$nome'"
Write-Host "Histórico: $(Join-Path (Split-Path -Parent $PSScriptRoot) 'dados\atualizacao.log')"
