@echo off
rem Atualiza o painel de faturas. Pode ser agendado no Agendador de Tarefas do Windows.
cd /d "%~dp0"
python coletor.py >> coletor.log 2>&1
