@echo off
title Zenith Footprint Terminal - Launcher
echo ==========================================
echo    INICIANDO ZENITH FOOTPRINT TERMINAL
echo ==========================================
echo.
echo [1/2] Iniciando Servidor e Interface...
start "ZENITH TERMINAL" cmd /c "cd dados && node server.js"
timeout /t 5 > null

echo.
echo ==========================================
echo    SISTEMA PRONTO! MOTOR EM STANDBY.
echo    Pode clicar em LIGAR MOTOR no grafico.
echo ==========================================
echo.
pause
