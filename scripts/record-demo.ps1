<#
.SYNOPSIS
  Records a README-sized GIF of Argus in use.

.DESCRIPTION
  Captures the desktop with ffmpeg, then encodes a GIF with a per-clip colour
  palette. Two passes rather than one: a GIF is limited to 256 colours, and
  letting ffmpeg choose them from this clip instead of a fixed web palette is
  the difference between a readable screenshot and a dithered mess.

  You act; this handles the countdown, the capture, the sizing and the
  encoding. Nothing here touches the mouse or keyboard.

.EXAMPLE
  .\scripts\record-demo.ps1 -Seconds 8 -Out docs/demo.gif

.EXAMPLE
  # Just the middle of the screen, where the bar and the ghost cursor are.
  .\scripts\record-demo.ps1 -Seconds 10 -Region 240,140,1440,810
#>
[CmdletBinding()]
param(
  # How long to record, in seconds. A README GIF wants 6-12; past that the file
  # grows and people stop watching.
  [int]$Seconds = 8,

  [string]$Out = 'docs/demo.gif',

  # Seconds of countdown before recording starts, to get to the right window.
  [int]$Countdown = 5,

  # Output width in pixels. GitHub renders a README about 830px wide, so
  # anything past ~1000 is bytes nobody sees.
  [int]$Width = 960,

  # Frames per second in the GIF. 12-15 reads as smooth for desktop UI.
  [int]$Fps = 13,

  # Optional crop, as "x,y,width,height" in screen pixels. Cropping to where
  # the action is beats scaling the whole desktop down until text is mush.
  [string]$Region = '',

  # Keep the intermediate lossless capture, e.g. to re-encode at other sizes.
  [switch]$KeepSource,

  # Skip the MP4. By default one recording produces both, because they are for
  # two different jobs - see the note above the encode below.
  [switch]$NoVideo,

  # Width of the MP4. Video compresses far better than a GIF, so it can afford
  # detail the GIF cannot.
  [int]$VideoWidth = 1280
)

$ErrorActionPreference = 'Stop'

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($null -eq $ffmpeg) {
  Write-Host 'ffmpeg is not on PATH. Install it with:  winget install Gyan.FFmpeg' -ForegroundColor Red
  exit 1
}

# Resolve the output path relative to the repo, not to wherever you happen to
# be standing when you run this.
$repo = Split-Path -Parent $PSScriptRoot
if (-not [System.IO.Path]::IsPathRooted($Out)) { $Out = Join-Path $repo $Out }
$outDir = Split-Path -Parent $Out
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }

$raw = Join-Path ([System.IO.Path]::GetTempPath()) ("argus-demo-" + [guid]::NewGuid().ToString('N') + '.mkv')

# --- capture arguments ------------------------------------------------------
$capture = @('-hide_banner', '-loglevel', 'error', '-f', 'gdigrab', '-framerate', "$Fps")

if ($Region -ne '') {
  $parts = $Region -split '\s*,\s*'
  if ($parts.Count -ne 4) {
    Write-Host 'Region must be "x,y,width,height", e.g. -Region 240,140,1440,810' -ForegroundColor Red
    exit 1
  }
  # gdigrab wants even dimensions; an odd one fails at encode time, not here,
  # which is a confusing place to find out.
  $rw = [int]$parts[2]; $rh = [int]$parts[3]
  if ($rw % 2) { $rw-- }
  if ($rh % 2) { $rh-- }
  $capture += @('-offset_x', $parts[0], '-offset_y', $parts[1], '-video_size', "${rw}x${rh}")
}

$capture += @('-t', "$Seconds", '-i', 'desktop', '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', $raw)

# --- countdown --------------------------------------------------------------
Write-Host ''
Write-Host '  Recording a demo GIF' -ForegroundColor Cyan
Write-Host "  $Seconds seconds, $Fps fps, $Width px wide -> $Out"
if ($Region -ne '') { Write-Host "  region: $Region" }
Write-Host ''
Write-Host '  Get to the window you want on camera.' -ForegroundColor Yellow
Write-Host ''

for ($i = $Countdown; $i -gt 0; $i--) {
  Write-Host "`r  starting in $i... " -NoNewline -ForegroundColor Yellow
  Start-Sleep -Seconds 1
}
Write-Host "`r  RECORDING            " -ForegroundColor Red

& ffmpeg @capture
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Capture failed.' -ForegroundColor Red
  exit 1
}

Write-Host '  done - encoding' -ForegroundColor Green

# --- encode -----------------------------------------------------------------
# stats_mode=diff weights the palette towards the pixels that actually change,
# which on a mostly-static desktop is exactly the part anyone is looking at.
$filter = "fps=$Fps,scale=${Width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle"

& ffmpeg -hide_banner -loglevel error -y -i $raw -vf $filter -loop 0 $Out
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Encoding failed.' -ForegroundColor Red
  exit 1
}

# --- and an MP4 -------------------------------------------------------------
# Both, from one recording, because they do different jobs. A GIF autoplays
# silently the instant the page loads, which is the only thing that works in
# the few seconds a visitor gives a repo. A GitHub-hosted video shows a play
# button and waits for a click, but carries audio, seeks, and far better
# quality per byte - which is what you want for the longer walkthrough further
# down the page.
#
# yuv420p is not optional: without it Safari and some Chrome builds refuse to
# play the file at all, and scale=-2 keeps the height even, which that pixel
# format requires.
$video = [System.IO.Path]::ChangeExtension($Out, '.mp4')
if (-not $NoVideo) {
  & ffmpeg -hide_banner -loglevel error -y -i $raw `
    -vf "scale=${VideoWidth}:-2:flags=lanczos" `
    -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 23 -preset slow `
    -movflags +faststart -an $video
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'MP4 encoding failed.' -ForegroundColor Red
    exit 1
  }
}

if ($KeepSource) {
  Write-Host "  kept the raw capture: $raw"
} else {
  Remove-Item $raw -Force -ErrorAction SilentlyContinue
}

$mb = [math]::Round((Get-Item $Out).Length / 1MB, 2)
Write-Host ''
Write-Host "  $Out  -  $mb MB   (autoplays at the top of the README)" -ForegroundColor Green

if ($mb -gt 10) {
  Write-Host '    over GitHub 10 MB image limit. Try -Seconds 8, -Width 800, or -Fps 10.' -ForegroundColor Yellow
} elseif ($mb -gt 5) {
  Write-Host '    fine, but -Width 800 would roughly halve it.' -ForegroundColor DarkYellow
}

if (-not $NoVideo) {
  $vmb = [math]::Round((Get-Item $video).Length / 1MB, 2)
  Write-Host "  $video  -  $vmb MB   (drag into a GitHub issue to get its URL)" -ForegroundColor Green
  # 10 MB is the ceiling on a free plan; 100 MB on a paid one. Failing the
  # upload after recording is a worse way to find out.
  if ($vmb -gt 10) {
    Write-Host '    over the 10 MB free-plan upload limit. Try -VideoWidth 960 or a shorter take.' -ForegroundColor Yellow
  }
}

Write-Host ''
Write-Host '  The GIF goes in the README as:  ![Argus demo](docs/demo.gif)' -ForegroundColor DarkGray
Write-Host '  The MP4 is uploaded, not committed - drag it into any GitHub issue' -ForegroundColor DarkGray
Write-Host '  comment box, copy the user-attachments URL it becomes, and paste that' -ForegroundColor DarkGray
Write-Host '  URL on a line of its own. GitHub renders it as a player.' -ForegroundColor DarkGray
Write-Host ''
