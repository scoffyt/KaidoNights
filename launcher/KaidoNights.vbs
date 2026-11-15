' Kaido Nights - abre o launcher sem janela de console
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
extra = ""
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "repair" Then extra = " -Repair"
End If
sh.Run "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\Launcher.ps1""" & extra, 0, False
