' Wohlig Attendance Sync: starts everything the admin computer needs and opens it as its own window.
'   1. the connector (reads the office device, sends punches to the HR Access Hub), hidden, if it is not already running
'   2. the log viewer (Devices, Punches, Resync logs, Event viewer), hidden, if it is not already running
'   3. the viewer in an app window (no address bar or tabs)
' Double-click it, or use the desktop icon made by install-desktop-icon.bat. Nothing here opens a black window.
Option Explicit
Dim sh, fso, folder, wmi
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = folder

Function IsRunning(word)
  Dim procs, p
  IsRunning = False
  Set procs = wmi.ExecQuery("Select CommandLine From Win32_Process Where Name = 'node.exe'")
  For Each p In procs
    If Not IsNull(p.CommandLine) Then
      If InStr(p.CommandLine, word) > 0 Then IsRunning = True
    End If
  Next
End Function

Set wmi = GetObject("winmgmts:\\.\root\cimv2")
If sh.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Then
  MsgBox "Node.js is not installed on this computer. Install it from https://nodejs.org (LTS), then open Wohlig Attendance Sync again.", 48, "Wohlig Attendance Sync"
  WScript.Quit 1
End If
If Not fso.FileExists(folder & "\.env") Then
  MsgBox "The settings file .env is missing in " & folder & ". Copy .env.example to .env and fill it in first.", 48, "Wohlig Attendance Sync"
  WScript.Quit 1
End If
If Not fso.FolderExists(folder & "\node_modules") Then
  MsgBox "Setting up for the first time. This takes a minute; press OK and wait.", 64, "Wohlig Attendance Sync"
  sh.Run "cmd /c npm install", 0, True
End If

If Not IsRunning("bridge.mjs") Then sh.Run """" & folder & "\run-forever.bat""", 0, False
If Not IsRunning("viewer.mjs") Then sh.Run "cmd /c node viewer.mjs >> viewer.log 2>&1", 0, False
WScript.Sleep 2500
sh.Run "cmd /c start """" msedge --app=http://localhost:4010 --window-size=1280,860", 0, False
