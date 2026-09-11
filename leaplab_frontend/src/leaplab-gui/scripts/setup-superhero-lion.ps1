# Superhero Lion Sprite Setup Script
# This script helps you rename and copy your lion sprite images to the correct location

Write-Host "Superhero Lion Sprite Setup" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

$targetDir = "public/assets/sprites/leap"
$expectedFiles = @(
    "superhero_lion_superhero_lion-a.png",
    "superhero_lion_superhero_lion-b.png",
    "superhero_lion_superhero_lion-c.png",
    "superhero_lion_superhero_lion-d.png"
)

# Check if target directory exists
if (-not (Test-Path $targetDir)) {
    Write-Host "Error: Target directory not found: $targetDir" -ForegroundColor Red
    exit 1
}

Write-Host "Target directory: $targetDir" -ForegroundColor Green
Write-Host ""

# Check which files are already in place
Write-Host "Checking for existing files..." -ForegroundColor Yellow
$missingFiles = @()
$foundFiles = @()

foreach ($file in $expectedFiles) {
    $fullPath = Join-Path $targetDir $file
    if (Test-Path $fullPath) {
        Write-Host "  [OK] Found: $file" -ForegroundColor Green
        $foundFiles += $file
    } else {
        Write-Host "  [MISSING] Missing: $file" -ForegroundColor Red
        $missingFiles += $file
    }
}

Write-Host ""

if ($missingFiles.Count -eq 0) {
    Write-Host "SUCCESS: All sprite files are in place!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Restart your dev server (bun dev)" -ForegroundColor White
    Write-Host "  2. Open the sprite library in your application" -ForegroundColor White
    Write-Host "  3. Search for 'Superhero Lion'" -ForegroundColor White
    Write-Host "  4. Add it to your project and test!" -ForegroundColor White
} else {
    Write-Host "WARNING: Missing $($missingFiles.Count) file(s)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Please copy your 4 lion sprite images to:" -ForegroundColor Cyan
    Write-Host "  $targetDir" -ForegroundColor White
    Write-Host ""
    Write-Host "With these exact names:" -ForegroundColor Cyan
    foreach ($file in $expectedFiles) {
        Write-Host "  • $file" -ForegroundColor White
    }
    Write-Host ""
    Write-Host "Tip: If your files have different names, rename them before copying." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "For more details, see: SUPERHERO_LION_SPRITE_GUIDE.md" -ForegroundColor Cyan
