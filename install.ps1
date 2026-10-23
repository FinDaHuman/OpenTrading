# OpenTrading installer for Windows (PowerShell 5.1+).
#
#   powershell -ExecutionPolicy ByPass -c "irm https://raw.githubusercontent.com/FinDaHuman/OpenTrading/main/install.ps1 | iex"
#
# Options (run the file itself, or set the matching environment variable before `irm | iex`):
#   -Version 0.2.0     install that release instead of the latest   (OPENTRADING_VERSION)
#   -InstallDir <dir>  where opentrading.exe and ot.exe go           (OPENTRADING_INSTALL_DIR)
#                      default: %USERPROFILE%\.opentrading\bin
#   -Binary <file>     install a local opentrading.exe instead of downloading
#   -NoModifyPath      do not add the folder to the user PATH
#   -Uninstall         remove opentrading.exe, ot.exe and the PATH entry (keeps ~\.opentrading data)

param(
  [string]$Version = $env:OPENTRADING_VERSION,
  [string]$InstallDir = $env:OPENTRADING_INSTALL_DIR,
  [string]$Binary = "",
  [switch]$NoModifyPath,
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
# Windows PowerShell 5.1 draws a progress bar per chunk, which makes a 40 MB download crawl.
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo = "FinDaHuman/OpenTrading"
if (-not $InstallDir) { $InstallDir = Join-Path $HOME ".opentrading\bin" }
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$Exe = Join-Path $InstallDir "opentrading.exe"
$Alias = Join-Path $InstallDir "ot.exe"

function Write-Step([string]$Text) { Write-Host $Text -ForegroundColor DarkGray }
# throw, never exit: under `irm | iex` an exit would close the user's PowerShell window.
function Fail([string]$Text) { throw "OpenTrading install: $Text" }

# The user PATH straight from the registry: unexpanded (%USERPROFILE%\... stays as written) and
# written back as REG_EXPAND_SZ. [Environment]::SetEnvironmentVariable would expand every entry
# and store a plain string.
function Get-UserPath {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment")
  try { [string]$key.GetValue("Path", "", "DoNotExpandEnvironmentNames") } finally { $key.Close() }
}

function Set-UserPath([string]$Value) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)
  try { $key.SetValue("Path", $Value, [Microsoft.Win32.RegistryValueKind]::ExpandString) } finally { $key.Close() }
  # Setting any user variable broadcasts WM_SETTINGCHANGE, so new terminals see the new PATH.
  [Environment]::SetEnvironmentVariable("OPENTRADING_INSTALL_REFRESH", "1", "User")
  [Environment]::SetEnvironmentVariable("OPENTRADING_INSTALL_REFRESH", $null, "User")
}

function Test-SameDir([string]$Entry, [string]$Dir) {
  $Entry -and ([Environment]::ExpandEnvironmentVariables($Entry).TrimEnd("\") -ieq $Dir.TrimEnd("\"))
}

function Test-OnPath([string]$Path, [string]$Dir) {
  @($Path -split ";" | Where-Object { Test-SameDir $_ $Dir }).Count -gt 0
}

function Get-Target {
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  if ($arch -eq "Arm64") { return "windows-arm64" }
  if ($arch -ne "X64") { Fail "unsupported CPU architecture: $arch (OpenTrading ships x64 and arm64)" }
  # PF_AVX2_INSTRUCTIONS_AVAILABLE = 40. When the check itself fails, the baseline build is the safe one.
  $avx2 = $false
  try {
    $kernel = Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(int f);' -Name OtKernel32 -Namespace OtInstall -PassThru
    $avx2 = $kernel::IsProcessorFeaturePresent(40)
  } catch {}
  if ($avx2) { "windows-x64" } else { "windows-x64-baseline" }
}

# A running opentrading.exe (or its ot.exe link) can be renamed but not overwritten.
function Move-Aside([string]$File) {
  if (-not (Test-Path -LiteralPath $File)) { return }
  $old = "$File.old"
  Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $old) { $old = "$File.$([DateTime]::Now.Ticks).old" }
  Move-Item -LiteralPath $File -Destination $old -Force
}

function Remove-Old {
  Get-ChildItem -LiteralPath $InstallDir -Filter "*.old" -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
}

if ($Uninstall) {
  foreach ($file in @($Exe, $Alias)) {
    if (Test-Path -LiteralPath $file) { Move-Aside $file }
  }
  Remove-Old
  $userPath = Get-UserPath
  if ($userPath -and (Test-OnPath $userPath $InstallDir)) {
    # Only our entry goes; everything else (empty entries included) stays as it was.
    $kept = ($userPath -split ";" | Where-Object { -not (Test-SameDir $_ $InstallDir) }) -join ";"
    Set-UserPath $kept
    Write-Step "removed $InstallDir from the user PATH"
  }
  $data = if ($env:OPENTRADING_HOME) { $env:OPENTRADING_HOME } else { Join-Path $HOME ".opentrading" }
  Write-Host "OpenTrading removed from $InstallDir. Your data in $data was kept (delete it yourself if you want)." -ForegroundColor Green
  return
}

$work = Join-Path ([IO.Path]::GetTempPath()) ("opentrading-install-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  if ($Binary) {
    if (-not (Test-Path -LiteralPath $Binary -PathType Leaf)) { Fail "no file at $Binary" }
    # Copied first: -Binary may be the very file about to be moved aside.
    $new = Join-Path $work "opentrading.exe"
    Copy-Item -LiteralPath (Resolve-Path -LiteralPath $Binary).Path -Destination $new
  } else {
    $target = Get-Target
    $asset = "opentrading-$target.zip"
    $tag = if ($Version) { "v" + $Version.TrimStart("v") } else { "" }
    $base = if ($tag) { "https://github.com/$Repo/releases/download/$tag" } else { "https://github.com/$Repo/releases/latest/download" }
    # Tests point this at a local server holding the archives and SHA256SUMS.
    if ($env:OPENTRADING_RELEASE_BASE) { $base = $env:OPENTRADING_RELEASE_BASE.TrimEnd("/") }
    Write-Step "downloading $asset ($(if ($tag) { $tag } else { 'latest' }))"
    $zip = Join-Path $work $asset
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $zip
      Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile (Join-Path $work "SHA256SUMS")
    } catch {
      Fail "download failed from $base ($($_.Exception.Message)). Check the version at https://github.com/$Repo/releases"
    }
    $line = Get-Content (Join-Path $work "SHA256SUMS") | Where-Object { $_ -match "\s\*?$([regex]::Escape($asset))$" } | Select-Object -First 1
    if (-not $line) { Fail "SHA256SUMS has no entry for $asset" }
    $expected = ($line -split "\s+")[0].ToLower()
    $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
    if ($expected -ne $actual) { Fail "checksum mismatch for $asset (expected $expected, got $actual)" }
    Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $work "x") -Force
    $new = Join-Path $work "x\opentrading.exe"
    if (-not (Test-Path -LiteralPath $new)) { Fail "$asset holds no opentrading.exe" }
  }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Remove-Old
  Move-Aside $Exe
  Move-Aside $Alias
  try {
    Copy-Item -LiteralPath $new -Destination $Exe
    # ot.exe: a hard link to the same file (no second 100 MB copy); a copy where links are not possible.
    try { New-Item -ItemType HardLink -Path $Alias -Target $Exe | Out-Null } catch { Copy-Item -LiteralPath $Exe -Destination $Alias }
  } catch {
    # Put the previous version back rather than leave nothing to run.
    foreach ($file in @($Exe, $Alias)) {
      if (-not (Test-Path -LiteralPath $file) -and (Test-Path -LiteralPath "$file.old")) { Move-Item -LiteralPath "$file.old" -Destination $file }
    }
    Fail "could not write to $InstallDir ($($_.Exception.Message))"
  }
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
# The previous version is gone unless it is still running; then the next install or update removes it.
Remove-Old

$versionOut = & $Exe --version
if ($LASTEXITCODE -ne 0) { Fail "$Exe does not start" }
$installed = @($versionOut)[0]

if (-not $NoModifyPath) {
  $userPath = Get-UserPath
  if (-not $userPath -or -not (Test-OnPath $userPath $InstallDir)) {
    $newPath = if ($userPath) { "$InstallDir;$userPath" } else { $InstallDir }
    Set-UserPath $newPath
    Write-Step "added $InstallDir to the user PATH"
  }
  if (-not (Test-OnPath $env:Path $InstallDir)) { $env:Path = "$InstallDir;$env:Path" }
  if ($env:GITHUB_PATH) { Add-Content -LiteralPath $env:GITHUB_PATH -Value $InstallDir }
}

# An older `bun run install:global` launcher (~\.local\bin\ot.cmd) earlier on PATH would win.
$first = Get-Command ot -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if ($first -and -not ($first.Source -like "$InstallDir\*")) {
  Write-Host "note: 'ot' currently runs $($first.Source). Remove it (in the repo: bun run uninstall:global) or put $InstallDir first on PATH." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "$installed installed to $InstallDir" -ForegroundColor Green
Write-Host "Open a new terminal and run:  ot        (or: opentrading)"
Write-Host "Update later with:            ot update"
