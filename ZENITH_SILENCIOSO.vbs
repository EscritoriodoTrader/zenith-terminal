Set WshShell = CreateObject("WScript.Shell")
' Define a pasta de trabalho como a pasta 'dados'
WshShell.CurrentDirectory = "d:\Indicador\FOOTPRINT\dados"
' Executa o Node.js diretamente em modo oculto (0)
WshShell.Run "node server.js", 0
Set WshShell = Nothing
