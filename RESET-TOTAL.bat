@echo off
title ZENITH - RESET TOTAL
color 0C

echo ======================================================
echo           ZENITH TERMINAL - RESET TOTAL
echo ======================================================
echo.
echo [1/3] Limpando Banco de Dados na Nuvem...
curl -X POST http://localhost:3000/api/trades/clear >nul 2>&1

echo [2/3] Finalizando processos (Limpeza de Memoria)...
taskkill /F /IM node.exe /T >nul 2>&1
taskkill /F /IM python.exe /T >nul 2>&1

echo [3/3] Reiniciando Motor Limpo...
timeout /t 2 >nul

start /d "d:\Indicador\FOOTPRINT" LIGAR-MOTOR.bat

echo.
echo ------------------------------------------------------
echo   RESET CONCLUIDO! 
echo   O Navegador e a Nuvem foram limpos com sucesso.
echo ------------------------------------------------------
timeout /t 3
exit
