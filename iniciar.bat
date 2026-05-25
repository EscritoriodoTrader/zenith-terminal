@echo off
:: Executa em modo invisível se não tiver o parâmetro 'hidden'
if "%~1"=="hidden" goto :start

echo Set WshShell = CreateObject("WScript.Shell") > "%temp%\run_hidden.vbs"
echo WshShell.Run chr(34) ^& "%~f0" ^& chr(34) ^& " hidden", 0, False >> "%temp%\run_hidden.vbs"
wscript "%temp%\run_hidden.vbs"
del "%temp%\run_hidden.vbs"
exit /b

:start
title Zenith Terminal (Node & Python)
color 0B
cls

echo =================================================================
echo.
echo   ███████╗███████╗███╗   ██╗██╗████████╗██╗  ██╗
echo   ╚══███╔╝██╔════╝████╗  ██║██║╚══██╔══╝██║  ██║
echo     ███╔╝ █████╗  ██╔██╗ ██║██║   ██║   ███████║
echo    ███╔╝  ██╔══╝  ██║╚██╗██║██║   ██║   ██╔══██║
echo   ███████╗███████╗██║ ╚████║██║   ██║   ██║  ██║
echo   ╚══════╝╚══════╝╚═╝  ╚═══╝╚═╝   ╚═╝   ╚═╝  ╚═╝
echo.
echo =================================================================
echo   [+] PREPARANDO MOTOR DE FLUXO DE DADOS...
echo   [+] VERIFICANDO INTEGRACAO SUPABASE E POSTGRES...
echo   [+] INICIANDO INTERFACE WEB DO FOOTPRINT...
echo =================================================================
echo.

:: Aguarda 2 segundos e abre o gráfico Zenith no navegador padrão do Windows
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000/Grafico/index.html"

:: Acessa o diretório de dados e executa o servidor local
cd /d "%~dp0dados"
npm run dev

echo.
echo   [!] Servidor encerrado.
pause
