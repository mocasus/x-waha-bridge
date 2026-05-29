$ErrorActionPreference = 'Stop'

Write-Host 'Enabling Windows features for Docker Desktop...'

Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -All -NoRestart
Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All -NoRestart

try {
  bcdedit /set hypervisorlaunchtype auto | Out-Null
} catch {
  Write-Warning 'Unable to set hypervisorlaunchtype automatically.'
}

Write-Host 'Docker prerequisites enabled. Rebooting now...'
Restart-Computer -Force
