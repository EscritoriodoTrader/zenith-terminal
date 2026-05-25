@echo off
title Zenith Terminal (Modo Visivel)
color 0A
cls

echo =================================================================
echo.
echo   [ZENITH C#] INICIANDO MODO TERMINAL VISIVEL...
echo.
echo =================================================================
echo.

:: Aguarda 2 segundos e abre o grafico Zenith no navegador padrao
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000/Grafico/index.html"

:: Acessa o diretorio de dados e executa o servidor local
cd /d "%~dp0dados"
npm run dev

pause
