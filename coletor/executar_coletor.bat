@echo off
rem Atualiza o painel de faturas. Pode ser agendado no Agendador de Tarefas do Windows.
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py coletor.py >> coletor.log 2>&1
) else (
  python coletor.py >> coletor.log 2>&1
)
