@echo off
title Zenith Launcher
echo ==========================================
echo    INICIANDO ZENITH FOOTPRINT TERMINAL
echo ==========================================
echo.
echo [1/2] Iniciando Servidor (Invisivel)...
start wscript.exe launcher_silencioso.vbs
timeout /t 3 > null

echo [2/2] Abrindo Aplicativo Zenith...
start chrome.exe --app=http://localhost:3000

echo.
echo ==========================================
echo    SISTEMA PRONTO! 
echo ==========================================
:: Alerta nativo do Windows
powershell -Command "[Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.MessageBox]::Show('O servidor Zenith esta pronto! Voce ja pode ligar o motor no grafico.', 'Zenith Terminal')"
exit
