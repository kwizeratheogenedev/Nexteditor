$ErrorActionPreference = 'Stop'
$backend = Split-Path -Parent $PSScriptRoot
$whisper = Join-Path $backend 'whisper'
$runtime = Join-Path $whisper 'runtime'
$models = Join-Path $whisper 'models'
$archive = Join-Path $env:TEMP 'whisper-cpp-win-x64.zip'

New-Item -ItemType Directory -Force -Path $runtime, $models | Out-Null

Write-Host 'Finding the latest official whisper.cpp Windows build...'
$release = Invoke-RestMethod 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest'
$asset = $release.assets | Where-Object { $_.name -match '^whisper-bin-x64\.zip$' } | Select-Object -First 1
if (-not $asset) {
  $asset = $release.assets | Where-Object { $_.name -match 'whisper.*bin-x64\.zip$' -and $_.name -notmatch 'cuda|cublas|vulkan|openvino' } | Select-Object -First 1
}
if (-not $asset) { throw 'The latest whisper.cpp release does not contain a CPU Windows x64 archive.' }

Write-Host "Downloading $($asset.name)..."
Invoke-WebRequest $asset.browser_download_url -OutFile $archive
Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
Remove-Item -LiteralPath $archive -Force

$modelPath = Join-Path $models 'ggml-base.bin'
if (-not (Test-Path $modelPath)) {
  Write-Host 'Downloading the multilingual Whisper base model (~142 MB)...'
  Invoke-WebRequest 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin' -OutFile $modelPath
}

$cli = Get-ChildItem $runtime -Filter 'whisper-cli.exe' -Recurse | Select-Object -First 1
if (-not $cli) { throw 'whisper-cli.exe was not found after extraction.' }
Write-Host "Local Whisper is ready: $($cli.FullName)"
Write-Host "Model: $modelPath"
