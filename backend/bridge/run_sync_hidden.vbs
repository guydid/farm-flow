' Runs one sync without a console window (used by the scheduled task)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "pythonw farmflow_sync.py", 0, False
