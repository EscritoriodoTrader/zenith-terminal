@echo off
title ZENITH TERMINAL - Injetor de Dados
echo ========================================
echo   LIGANDO MOTOR DE DADOS ZENITH...
echo ========================================
REM Fecha qualquer versão que já esteja rodando para não dar conflito
taskkill /F /FI "COMMANDLINE eq *scanner.py*" /T >nul 2>&1
cd /d %~dp0
python dados/scanner.py
pause
