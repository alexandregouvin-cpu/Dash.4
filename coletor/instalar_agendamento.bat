@echo off
rem Cria ou recria a tarefa "Coletor de faturas" no Agendador (07:00 e 13:00, sem janela).
rem Rode uma vez com dois cliques, no computador que roda o coletor.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar_agendamento.ps1"
echo.
pause
