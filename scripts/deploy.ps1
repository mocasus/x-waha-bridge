$ErrorActionPreference = 'Stop'

$dockerCli = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$dockerDesktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'

if (-not (Test-Path $dockerCli)) {
  throw 'Docker CLI not found. Install Docker Desktop first.'
}

if (-not (Test-Path $dockerDesktop)) {
  throw 'Docker Desktop executable not found.'
}

Start-Process -FilePath $dockerDesktop | Out-Null

$deadline = (Get-Date).AddMinutes(5)
while ((Get-Date) -lt $deadline) {
  try {
    & $dockerCli info | Out-Null
    break
  } catch {
    Start-Sleep -Seconds 5
  }
}

& $dockerCli info | Out-Null
& $dockerCli compose up -d --build

Write-Host 'Stack started. Check http://localhost:8080/healthz for bridge health. If you use remote WAHA, open the remote dashboard from your .env settings.'
