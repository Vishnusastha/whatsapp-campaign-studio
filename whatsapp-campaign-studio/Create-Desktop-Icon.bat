@echo off
setlocal
cd /d "%~dp0"

echo ========================================================
echo   Updating WhatsApp Campaign Studio Desktop Shortcut...
echo ========================================================

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$projectDir = '%~dp0'.TrimEnd('\'); " ^
  "$targetBat = Join-Path $projectDir 'start.bat'; " ^
  "$iconPath = Join-Path $projectDir 'campaign_studio_icon.ico'; " ^
  "$candidateDesktops = @( " ^
  "  [Environment]::GetFolderPath('Desktop'), " ^
  "  (Join-Path $env:USERPROFILE 'OneDrive\Desktop'), " ^
  "  (Join-Path $env:USERPROFILE 'Desktop') " ^
  ") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique; " ^
  "foreach ($d in $candidateDesktops) { " ^
  "  $oldLnk1 = Join-Path $d 'WhatsApp Dispatch Studio.lnk'; " ^
  "  $oldLnk2 = Join-Path $d 'WhatsApp Campaign Studio.lnk'; " ^
  "  if (Test-Path $oldLnk1) { Remove-Item -Force $oldLnk1 -ErrorAction SilentlyContinue; } " ^
  "  if (Test-Path $oldLnk2) { Remove-Item -Force $oldLnk2 -ErrorAction SilentlyContinue; } " ^
  "  $shortcut = $ws.CreateShortcut($oldLnk2); " ^
  "  $shortcut.TargetPath = $targetBat; " ^
  "  $shortcut.WorkingDirectory = $projectDir; " ^
  "  $shortcut.IconLocation = ($iconPath + ',0'); " ^
  "  $shortcut.Description = 'Launch WhatsApp Campaign Studio'; " ^
  "  $shortcut.Save(); " ^
  "  Write-Host '[SUCCESS] Updated Desktop icon at:' $d; " ^
  "} " ^
  "$folderLnk = Join-Path $projectDir 'Launch WhatsApp Campaign Studio.lnk'; " ^
  "if (Test-Path $folderLnk) { Remove-Item -Force $folderLnk -ErrorAction SilentlyContinue; } " ^
  "$scFolder = $ws.CreateShortcut($folderLnk); " ^
  "$scFolder.TargetPath = $targetBat; " ^
  "$scFolder.WorkingDirectory = $projectDir; " ^
  "$scFolder.IconLocation = ($iconPath + ',0'); " ^
  "$scFolder.Description = 'Launch WhatsApp Campaign Studio'; " ^
  "$scFolder.Save(); " ^
  "Write-Host '[SUCCESS] Updated folder shortcut at:' $folderLnk; " ^
  "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class ShellHelper { [DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2); }'; " ^
  "[ShellHelper]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero); "

echo.
echo ========================================================
echo   [DONE] WhatsApp Campaign Studio Icon Updated!
echo ========================================================
echo.
pause
