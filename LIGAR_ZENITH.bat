@echo off
title ZENITH TERMINAL - Injetor de Dados
echo ========================================
echo   LIGANDO MOTOR DE DADOS ZENITH...
echo ========================================
cd /d %~dp0
python dados/scanner.py
pause
