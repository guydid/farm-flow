' מפעיל את ממשק הגשר ללא חלון מסוף שחור
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "pythonw farmflow_sync_ui.py", 0, False
