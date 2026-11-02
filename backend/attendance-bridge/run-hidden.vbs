' Starts run-forever.bat with no window, so the connector runs quietly in the background.
Set sh = CreateObject("WScript.Shell")
folder = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = folder
sh.Run """" & folder & "\run-forever.bat""", 0, False
