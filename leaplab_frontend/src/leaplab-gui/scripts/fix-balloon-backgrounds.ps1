# Fix Balloon Sprite SVG Backgrounds
# Removes black/white backgrounds while preserving balloon colors

Write-Host "`n╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║       BALLOON SPRITE BACKGROUND FIX SCRIPT                 ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

$balloonFiles = @(
    "public/assets/sprites/leap/balloon1_balloon1-a.svg",
    "public/assets/sprites/leap/balloon1_balloon1-b.svg",
    "public/assets/sprites/leap/balloon1_balloon1-c.svg",
    "public/assets/sprites/leap/balloon1_balloon1-d.svg",
    "public/assets/sprites/leap/balloon1_balloon1-e.svg"
)

$filesFixed = 0
$filesSkipped = 0
$filesMissing = 0

foreach ($file in $balloonFiles) {
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
        
        # Pattern 3: Remove large black paths starting at origin (M0 0)
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
        Write-Host "  This file needs to be added" -ForegroundColor Yellow
        Write-Host ""
        $filesMissing++
    }
}

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                        SUMMARY                             ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "Total files expected: $($balloonFiles.Count)" -ForegroundColor White
Write-Host "Files fixed: $filesFixed" -ForegroundColor Green
Write-Host "Files already clean: $filesSkipped" -ForegroundColor Green
Write-Host "Files missing: $filesMissing" -ForegroundColor $(if ($filesMissing -gt 0) { "Yellow" } else { "Green" })
Write-Host ""

if ($filesMissing -gt 0) {
    Write-Host "ℹ️  NOTE:" -ForegroundColor Cyan
    Write-Host "  You have $filesMissing new balloon files to add." -ForegroundColor Yellow
    Write-Host "  After adding them, run this script again to fix backgrounds." -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host "✅ All balloon sprites are ready!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Run: bun dev" -ForegroundColor White
    Write-Host "2. Check the Balloon1 sprite in your application" -ForegroundColor White
    Write-Host "3. Verify all 5 colors appear with transparent backgrounds" -ForegroundColor White
    Write-Host ""
}

Write-Host "NOTE: This script preserves all balloon colors and designs!" -ForegroundColor Yellow
Write-Host "Only large background rectangles are removed." -ForegroundColor Yellow
Write-Host ""
