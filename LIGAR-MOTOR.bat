@echo off
title ZENITH TERMINAL - MOTOR DE DADOS
color 0A

echo ======================================================
echo           ZENITH TERMINAL - INICIALIZADOR
echo ======================================================
echo.
echo [1/3] Finalizando processos antigos...
taskkill /F /IM node.exe /T >nul 2>&1
taskkill /F /IM python.exe /T >nul 2>&1

echo [2/3] Entrando na pasta de dados...
cd /d "C:\FOOTPRINT\dados"

echo [3/3] Iniciando o Motor Zenith (Node + Python)...
echo.
echo ------------------------------------------------------
echo   O motor estara pronto quando voce ver:
echo   "ZENITH ONLINE: Porta 3000"
echo ------------------------------------------------------
echo.

node server.js

pause
