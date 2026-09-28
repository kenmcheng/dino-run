# Build the game's 3D assets with Blender (headless). Windows / PowerShell.
#
#   .\art\build.ps1                      # everything
#   .\art\build.ps1 -Only trex,raptor     # some assets (or a group: costumes, props, scenery)
#   .\art\build.ps1 -Only trex -Preview   # also write review renders to art/.cache/previews
#
# Set $env:BLENDER to pick a Blender executable (4.2 or newer; 5.x recommended).
param([string[]]$Only = @(), [switch]$Preview, [double]$Size = 1)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root 'art\blender\build.py'
$log = Join-Path $root 'art\.cache\build.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null

$blender = $env:BLENDER
if (-not $blender) {
  $cmd = Get-Command blender -ErrorAction SilentlyContinue
  if (-not $cmd) { $cmd = Get-Command blender-launcher -ErrorAction SilentlyContinue }  # Microsoft Store install
  if ($cmd) { $blender = $cmd.Source }
}
if (-not $blender) {
  $found = Get-ChildItem 'C:\Program Files\Blender Foundation\*\blender.exe' -ErrorAction SilentlyContinue | Sort-Object FullName | Select-Object -Last 1
  if ($found) { $blender = $found.FullName }
}
if (-not $blender) { throw 'Blender not found. Install Blender 4.2+ or set $env:BLENDER.' }

$argv = @('-b', '--factory-startup', '-P', "`"$script`"", '--', '--log', "`"$log`"", '--size', $Size)
if ($Only.Count) { $argv += @('--only', ($Only -join ',')) }
if ($Preview) { $argv += '--preview' }
Write-Host "Blender: $blender"
$p = Start-Process -FilePath $blender -ArgumentList $argv -Wait -PassThru -NoNewWindow
Get-Content $log
if ($p.ExitCode -ne 0 -or -not (Select-String -Path $log -Pattern '^\[.*\] exit 0$' -Quiet)) { exit 1 }
