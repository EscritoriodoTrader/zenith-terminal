@echo off
title LIMPEZA ZENITH - MODO TRADING
color 0a
echo ==========================================
echo    LIMPANDO PROCESSOS DE DESENVOLVIMENTO
echo ==========================================
echo.

echo [1/3] Finalizando Node.js...
taskkill /F /IM node.exe /T >nul 2>&1

echo [2/3] Finalizando Motores Python...
taskkill /F /IM python.exe /T >nul 2>&1

echo [3/3] Limpando auxiliares (Git/Code)...
taskkill /F /IM git.exe /T >nul 2>&1
taskkill /F /IM language_server_windows_x64.exe /T >nul 2>&1

echo.
echo ==========================================
echo    SISTEMA LIMPO! PRONTO PARA OPERAR.
echo ==========================================
pause
