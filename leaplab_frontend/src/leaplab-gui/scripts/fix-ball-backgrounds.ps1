# Fix Ball Sprite SVG Backgrounds
# Removes black/white backgrounds while preserving ball colors

Write-Host "`n╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║         BALL SPRITE BACKGROUND FIX SCRIPT                  ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

$ballFiles = @(
    "public/assets/sprites/leap/ball_ball-a.svg",
    "public/assets/sprites/leap/ball_ball-b.svg",
    "public/assets/sprites/leap/ball_ball-c.svg",
    "public/assets/sprites/leap/ball_ball-d.svg",
    "public/assets/sprites/leap/ball_ball-e.svg"
)

$filesFixed = 0
$filesSkipped = 0
$filesMissing = 0

foreach ($file in $ballFiles) {
    $fileName = Split-Path $file -Leaf
    
    if (Test-Path $file) {
        Write-Host "Processing: $fileName" -ForegroundColor Yellow
        
        # Read the SVG content
        $content = Get-Content $file -Raw
        $originalContent = $content
        $changesMade = $false
        
        # Pattern 1: Remove large black rectangles covering entire canvas
        $blackRectPattern = '<rect[^>]*width="1024"[^>]*height="1024"[^>]*fill="#0[0-2][0-2][0-2][0-2][0-2]"[^>]*\/?>'
        if ($content -match $blackRectPattern) {
            Write-Host "  → Found black background rectangle - REMOVING" -ForegroundColor Red
            $content = $content -replace $blackRectPattern, ''
            $changesMade = $true
        }
        
        # Pattern 2: Remove large white rectangles
        $whiteRectPattern = '<rect[^>]*width="1024"[^>]*height="1024"[^>]*fill="#[Ff]{6}"[^>]*\/?>'
        if ($content -match $whiteRectPattern) {
            Write-Host "  → Found white background rectangle - REMOVING" -ForegroundColor Red
            $content = $content -replace $whiteRectPattern, ''
            $changesMade = $true
        }
        
        # Pattern 3: Remove large black paths starting at origin
        $blackPathPattern = '<path d="M0 0[^"]{1000,}" fill="#0[0-2][0-2][0-2][0-2][0-2]"[^>]*\/?>'
        if ($content -match $blackPathPattern) {
            Write-Host "  → Found large black background path - REMOVING" -ForegroundColor Red
            $content = $content -replace $blackPathPattern, ''
            $changesMade = $true
        }
        
        # Pattern 4: Remove large white paths
        $whitePathPattern = '<path d="M0 0[^"]{1000,}" fill="#[Ff]{6}"[^>]*\/?>'
        if ($content -match $whitePathPattern) {
            Write-Host "  → Found large white background path - REMOVING" -ForegroundColor Red
            $content = $content -replace $whitePathPattern, ''
            $changesMade = $true
        }
        
        # Save if changes were made
        if ($changesMade) {
            Set-Content -Path $file -Value $content -NoNewline
            Write-Host "  ✓ Fixed and saved!" -ForegroundColor Green
            $filesFixed++
        } else {
            Write-Host "  ✓ No background issues - file is clean!" -ForegroundColor Green
            $filesSkipped++
        }
        
        Write-Host ""
    } else {
        Write-Host "⚠ File not found: $fileName" -ForegroundColor Red
        Write-Host "  Please add this file to: public/assets/sprites/leap/" -ForegroundColor Yellow
        Write-Host ""
        $filesMissing++
    }
}

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                        SUMMARY                             ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "Total files expected: $($ballFiles.Count)" -ForegroundColor White
Write-Host "Files fixed: $filesFixed" -ForegroundColor Green
Write-Host "Files already clean: $filesSkipped" -ForegroundColor Green
Write-Host "Files missing: $filesMissing" -ForegroundColor $(if ($filesMissing -gt 0) { "Red" } else { "Green" })
Write-Host ""

if ($filesMissing -gt 0) {
    Write-Host "⚠ ACTION REQUIRED:" -ForegroundColor Yellow
    Write-Host "  Please add the missing ball SVG files to:" -ForegroundColor Yellow
    Write-Host "  public/assets/sprites/leap/" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Expected filenames:" -ForegroundColor Yellow
    Write-Host "  - ball_ball-a.svg (Pink ball)" -ForegroundColor White
    Write-Host "  - ball_ball-b.svg (Purple ball)" -ForegroundColor White
    Write-Host "  - ball_ball-c.svg (Red ball)" -ForegroundColor White
    Write-Host "  - ball_ball-d.svg (Blue ball)" -ForegroundColor White
    Write-Host "  - ball_ball-e.svg (Orange ball)" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "✅ All ball sprites are ready!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Run: bun dev" -ForegroundColor White
    Write-Host "2. Check the Ball sprite in your application" -ForegroundColor White
    Write-Host "3. Verify all 5 colors appear with transparent backgrounds" -ForegroundColor White
    Write-Host ""
}

Write-Host "NOTE: This script preserves all ball colors and designs!" -ForegroundColor Yellow
Write-Host "Only large background rectangles are removed." -ForegroundColor Yellow
Write-Host ""
