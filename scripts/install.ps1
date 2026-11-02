# Fresh-clone install for Windows: Node ≥22, git, corepack, pnpm install + build.
$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$MinNode = 22

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js is required but was not found." -ForegroundColor Red
  Write-Host "Install Node.js $MinNode+ from https://nodejs.org/ and re-run this script."
  exit 1
}

$nodeMajor = [int]((node -p "process.versions.node.split('.')[0]"))
if ($nodeMajor -lt $MinNode) {
  $ver = node -v
  Write-Host "Node.js $MinNode+ is required (found $ver)." -ForegroundColor Red
  Write-Host "Upgrade Node.js from https://nodejs.org/ and re-run this script."
  exit 1
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "git is required but was not found." -ForegroundColor Red
  Write-Host "Install git (https://git-scm.com/) and re-run this script."
  exit 1
}

Write-Host "→ Enabling corepack…"
corepack enable
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "→ Installing dependencies (pnpm install)…"
pnpm install
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "→ Building (pnpm build)…"
pnpm build
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Install complete."
Write-Host ""
Write-Host "Start the app with:"
Write-Host "  pnpm start"
Write-Host ""
Write-Host "(Use ``pnpm start -- --no-open`` to skip opening the browser.)"
