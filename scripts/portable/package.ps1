param([string]$Output = 'portable-out')
$ErrorActionPreference = 'Stop'
$baseline = Get-Content docs/portable/upstream.json -Raw | ConvertFrom-Json
$desktop = Get-Content apps/desktop/package.json -Raw | ConvertFrom-Json
$sha = (git rev-parse HEAD).Trim()
if ($sha -notmatch '^[a-f0-9]{40}$') { throw 'Invalid source SHA' }
if ($desktop.version -ne $baseline.desktopVersion) { throw 'Desktop version differs from reviewed baseline' }
$source = Resolve-Path apps/desktop/release/win-unpacked
if (Test-Path "$source/data") { throw 'Build output already contains user data' }
New-Item -ItemType Directory -Force $Output | Out-Null
$stage = Join-Path $Output 'stage/Hermes-Portable'
if (Test-Path $stage) { throw 'Refusing to reuse a possibly dirty package stage' }
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item "$source/*" $stage -Recurse
New-Item -ItemType File "$stage/portable.flag" | Out-Null
New-Item -ItemType Directory "$stage/resources/portable" -Force | Out-Null
Copy-Item scripts/install.ps1 "$stage/resources/portable/install.ps1"
Copy-Item LICENSE "$stage/LICENSE-Hermes.txt"
Copy-Item docs/portable "$stage/docs" -Recurse
$metadata = [ordered]@{
  schemaVersion = 1
  upstreamRepository = $baseline.repository
  upstreamRef = $baseline.ref
  upstreamTag = $baseline.adoptedTag
  upstreamCommit = $baseline.sha
  desktopVersion = $desktop.version
  forkRepository = $env:GITHUB_REPOSITORY
  forkCommit = $sha
  portableRevision = $baseline.portableRevision
  architecture = 'x64'
  builtAt = (Get-Date).ToUniversalTime().ToString('o')
  actionsRun = "$env:GITHUB_SERVER_URL/$env:GITHUB_REPOSITORY/actions/runs/$env:GITHUB_RUN_ID"
  actionsAttempt = $env:GITHUB_RUN_ATTEMPT
  environment = @{ imageOS=$env:ImageOS; imageVersion=$env:ImageVersion; node=(node --version); npm=(npm --version); electron=$desktop.devDependencies.electron; builder=$desktop.devDependencies.'electron-builder' }
  signed = $false
  acceptance = 'candidate; see matching test reports; not approved for public release'
}
$metadata | ConvertTo-Json -Depth 8 | Set-Content "$stage/portable-build.json" -Encoding utf8NoBOM
$name = "Hermes-$($desktop.version)-portable.$($baseline.portableRevision)-win-x64.zip"
$zip = Join-Path (Resolve-Path $Output) $name
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory((Resolve-Path "$Output/stage"), $zip)
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $name" | Set-Content "$Output/SHA256SUMS.txt" -Encoding ascii
Copy-Item "$stage/portable-build.json" "$Output/portable-build.json"
@{file=$name; sha256=$hash; source=$sha} | ConvertTo-Json | Set-Content "$Output/package.json" -Encoding utf8NoBOM
Remove-Item "$Output/stage" -Recurse -Force
Write-Host "Candidate ZIP SHA256: $hash"
