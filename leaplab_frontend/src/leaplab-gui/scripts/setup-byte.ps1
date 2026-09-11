# Byte Sprite Setup Script
# This script helps you verify your Byte character sprite images

Write-Host "Byte Character Sprite Setup" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

$targetDir = "public/assets/sprites/leap"
$expectedFiles = @(
    "byte_byte-a.png",
    "byte_byte-b.png",
    "byte_byte-c.png",
    "byte_byte-d.png"
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
        
        # Check file size
        $fileInfo = Get-Item $fullPath
        $sizeKB = [math]::Round($fileInfo.Length / 1KB, 2)
        Write-Host "       Size: $sizeKB KB" -ForegroundColor Gray
    } else {
        Write-Host "  [MISSING] Missing: $file" -ForegroundColor Red
        $missingFiles += $file
    }
}

Write-Host ""

if ($missingFiles.Count -eq 0) {
    Write-Host "SUCCESS: All sprite files are in place!" -ForegroundColor Green
    Write-Host ""
    
    # Check for transparency (basic check)
    Write-Host "Transparency Check:" -ForegroundColor Cyan
    Write-Host "  Please verify manually that your PNG files have transparent backgrounds" -ForegroundColor Yellow
    Write-Host "  Open each file in an image viewer - you should see a checkerboard pattern" -ForegroundColor Yellow
    Write-Host ""
    
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Verify transparent backgrounds on all 4 images" -ForegroundColor White
    Write-Host "  2. Restart your dev server (bun dev)" -ForegroundColor White
    Write-Host "  3. Open the sprite library in your application" -ForegroundColor White
    Write-Host "  4. Search for 'Byte' or 'tech' or 'coding'" -ForegroundColor White
    Write-Host "  5. Add it to your project and test!" -ForegroundColor White
} else {
    Write-Host "WARNING: Missing $($missingFiles.Count) file(s)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Please prepare your 4 Byte character images:" -ForegroundColor Cyan
    Write-Host "  1. Remove backgrounds (make them transparent)" -ForegroundColor White
    Write-Host "  2. Save as PNG format" -ForegroundColor White
    Write-Host "  3. Rename with these exact names:" -ForegroundColor White
    foreach ($file in $expectedFiles) {
        Write-Host "     - $file" -ForegroundColor White
    }
    Write-Host "  4. Copy to: $targetDir" -ForegroundColor White
    Write-Host ""
    Write-Host "Tip: Use tools like Remove.bg, Photoshop, or GIMP to remove backgrounds" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "For more details, see: BYTE_SPRITE_GUIDE.md" -ForegroundColor Cyan
