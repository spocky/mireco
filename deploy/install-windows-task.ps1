#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Serves the MiReCo HTTP version from this Windows PC at every startup.

.DESCRIPTION
  Builds dist\ and registers a scheduled task that runs the bundled Node.js
  static server on all network interfaces (no window, starts with Windows),
  plus a firewall rule for private networks. Run from an elevated PowerShell:

    powershell -ExecutionPolicy Bypass -File deploy\install-windows-task.ps1
    powershell -ExecutionPolicy Bypass -File deploy\install-windows-task.ps1 -Port 9000
    powershell -ExecutionPolicy Bypass -File deploy\install-windows-task.ps1 -Remove

  After pulling updates, run it again to rebuild and restart.
#>
param(
  [int]$Port = 8080,
  [switch]$Remove
)

$ErrorActionPreference = "Stop"
$taskName = "MiReCo HTTP"
$repo = Split-Path -Parent $PSScriptRoot

if ($Remove) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-NetFirewallRule -DisplayName $taskName -ErrorAction SilentlyContinue
  Write-Host "Removed the '$taskName' task and firewall rule."
  return
}

$node = (Get-Command node -ErrorAction Stop).Source
& $node (Join-Path $repo "scripts\build.mjs")
if ($LASTEXITCODE -ne 0) { throw "Build failed." }

$serve = Join-Path $repo "scripts\serve.mjs"
$dist = Join-Path $repo "dist"
$argList = "`"$serve`" --root `"$dist`" --host 0.0.0.0 --port $Port"

$action = New-ScheduledTaskAction -Execute $node -Argument $argList -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtStartup
# S4U: runs whether or not you're logged in, without a window or stored password.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description "MiReCo web remote, HTTP version (port $Port)" -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Remove-NetFirewallRule -DisplayName $taskName -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $taskName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private | Out-Null

$ips = Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp, Manual -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike "169.254.*" -and $_.InterfaceAlias -notmatch "vEthernet|WSL|Loopback" } |
  Select-Object -ExpandProperty IPAddress
Write-Host "MiReCo HTTP version is running and will start with Windows."
foreach ($ip in $ips) { Write-Host "  Open on your phone: http://${ip}:$Port/" }
Write-Host "Your Wi-Fi network must be set to 'Private' in Windows for the firewall rule to apply."
