$ErrorActionPreference = 'Stop'
$installer = Join-Path $env:TEMP 'vc_redist.x64.exe'
try {
  Invoke-WebRequest 'https://aka.ms/vs/17/release/vc_redist.x64.exe' -OutFile $installer
  $process = Start-Process -FilePath $installer -ArgumentList '/install', '/quiet', '/norestart' -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -notin @(0, 1638, 3010)) { throw "Visual C++ runtime installer exited with code $($process.ExitCode)." }
} finally {
  Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
}
