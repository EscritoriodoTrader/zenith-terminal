Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c cd dados && node server.js", 0, False
