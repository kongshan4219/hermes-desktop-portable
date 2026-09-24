# Exercise the actual Portable installer functions under production PS 5.1
# before paying for a full Desktop build and local bootstrap.
$ErrorActionPreference = 'Stop'
$fixture = Join-Path $env:RUNNER_TEMP 'Cua 中文 (private contract)'
$Portable = $true
$SkipComputerUse = $false
$HermesHome = Join-Path $fixture 'data\hermes'
$env:HOME = Join-Path $fixture 'data\home'
$env:USERPROFILE = $env:HOME
$env:APPDATA = Join-Path $env:HOME 'AppData\Roaming'
$env:LOCALAPPDATA = Join-Path $env:HOME 'AppData\Local'
$env:TEMP = Join-Path $fixture 'data\cache\temp'
$env:TMP = $env:TEMP
$env:CUA_DRIVER_RS_HOME = Join-Path $HermesHome 'cua\home'
$env:PATH = "$env:SystemRoot\System32;$env:SystemRoot\System32\WindowsPowerShell\v1.0;$env:SystemRoot"
foreach ($dir in @($HermesHome,$env:HOME,$env:APPDATA,$env:LOCALAPPDATA,$env:TEMP)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}
$beforePath = [Environment]::GetEnvironmentVariable('Path', 'User')
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path 'scripts/install.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors) { throw "Installer parse failed: $parseErrors" }
$names = @('Write-Info','Write-Success','Write-Warn','Write-Err','Test-CuaDriverRuntimeContract','Install-CuaDriver')
$functions = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in $names }, $true)
Invoke-Expression (($functions | ForEach-Object { $_.Extent.Text }) -join "`n")
$failure = $null
try { Install-CuaDriver } catch { $failure = $_ }
$driver = Join-Path $HermesHome 'cua\bin\cua-driver.exe'
$ErrorActionPreference = 'Continue'
if (Test-Path $driver) {
    $version = (& $driver --version 2>&1 | Out-String)
    Write-Host "Native version exit=$LASTEXITCODE output=$version"
    $manifest = (& $driver manifest 2>&1 | Out-String)
    Write-Host "Native manifest exit=$LASTEXITCODE"
    Write-Host $manifest.Substring(0, [Math]::Min(3000, $manifest.Length))
}
$ErrorActionPreference = 'Stop'
if ([Environment]::GetEnvironmentVariable('Path', 'User') -cne $beforePath) { throw 'Private Cua changed User PATH' }
if ($failure) { throw $failure }
Write-Host 'Portable Cua installer and upstream runtime contract passed on Windows PowerShell 5.1.'
