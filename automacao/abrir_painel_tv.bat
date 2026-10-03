@echo off
rem Abre o painel de entregas na TV: Edge em tela cheia (modo quiosque), já no Modo TV.
rem Para sair do modo quiosque: Alt+F4.
rem Coloque um atalho deste arquivo em shell:startup para abrir sozinho quando o computador da TV ligar.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = (Resolve-Path (Join-Path '%~dp0' '..\painel_tv.html')).Path; $u = ([Uri]$p).AbsoluteUri + '#tv'; Start-Process msedge -ArgumentList '--kiosk', $u, '--edge-kiosk-type=fullscreen', '--no-first-run'"
