@echo off
echo Compilando MarketDataRTD C# Nativo...
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /optimize /r:Microsoft.CSharp.dll /r:System.Net.Http.dll /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /out:MarketDataRTD.exe Program.cs
if %errorlevel% neq 0 (
    echo [ERRO] Falha na compilacao.
    exit /b %errorlevel%
)
echo [SUCESSO] MarketDataRTD.exe gerado com sucesso!
