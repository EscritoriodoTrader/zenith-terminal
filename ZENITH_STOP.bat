@echo off
echo Finalizando processos do Zenith...
taskkill /F /FI "COMMANDLINE eq *scanner.py*" /T
echo.
echo Sistema DESLIGADO com sucesso!
pause
