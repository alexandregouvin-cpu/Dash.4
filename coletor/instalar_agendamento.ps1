# Cria (ou recria) a tarefa "Coletor de faturas" no Agendador de Tarefas do Windows.
# Roda o coletor sem janela às 07:00 e às 13:00, também na bateria, recupera horário
# perdido (PC desligado) e encerra uma execução travada em vez de bloquear as seguintes.
$ErrorActionPreference = 'Stop'
$pasta = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $pasta 'coletor.py'

$pyw = (Get-Command pyw.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $pyw) { $pyw = (Get-Command pythonw.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source }
if ($pyw) {
    $acao = New-ScheduledTaskAction -Execute $pyw -Argument ('"{0}"' -f $script) -WorkingDirectory $pasta
} else {
    Write-Host 'Aviso: pyw.exe não encontrado; a tarefa vai usar o executar_coletor.bat (com janela).'
    $acao = New-ScheduledTaskAction -Execute (Join-Path $pasta 'executar_coletor.bat') -WorkingDirectory $pasta
}

$gatilhos = @(
    (New-ScheduledTaskTrigger -Daily -At '07:00'),
    (New-ScheduledTaskTrigger -Daily -At '13:00')
)
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
$quem = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'Coletor de faturas' -Description 'Atualiza o painel de faturas de frete' `
    -Action $acao -Trigger $gatilhos -Settings $config -Principal $quem -Force | Out-Null

Write-Host ''
Write-Host 'Tarefa "Coletor de faturas" pronta: todo dia às 07:00 e às 13:00, sem janela.'
Write-Host "Programa: $($acao.Execute) $($acao.Arguments)"
Write-Host 'Rodando uma vez agora para testar. Em 1 a 2 minutos confira o final do coletor.log.'
Start-ScheduledTask -TaskName 'Coletor de faturas'
