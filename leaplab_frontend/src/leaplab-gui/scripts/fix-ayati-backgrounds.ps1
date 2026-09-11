# Fix avery Walking SVG Background Script
# This script removes ONLY large background rectangles while preserving character design elements

Write-Host "=== avery Walking SVG Background Fix ===" -ForegroundColor Cyan
Write-Host ""

$svgFiles = @(
    "public/assets/sprites/leap/avery_walking_avery_walking-a.svg",
    "public/assets/sprites/leap/avery_walking_avery_walking-b.svg",
    "public/assets/sprites/leap/avery_walking_avery_walking-c.svg",
    "public/assets/sprites/leap/avery_walking_avery_walking-d.svg"
)

$filesFixed = 0
$filesSkipped = 0

foreach ($file in $svgFiles) {
    if (Test-Path $file) {
        Write-Host "Processing: $file" -ForegroundColor Yellow
        
        # Read the SVG content
        $content = Get-Content $file -Raw
        $originalContent = $content
        
        # Pattern 1: Remove large black rectangles that cover the entire canvas
        # These typically have coordinates starting at 0,0 and covering 1024x1024
        # Pattern: <path d="M0 0 C... (very long path) ..." fill="#000000" or similar dark colors
        
        # Look for paths that start with "M0 0" and have fill colors close to black
        # We'll remove paths that:
        # 1. Start with M0 0 (move to origin)
        # 2. Are very long (>1000 characters in the d attribute)
        # 3. Have dark fill colors (#000000, #010101, #020202, etc.)
        
        $pathPattern = '<path d="M0 0[^"]{1000,}" fill="#0[0-2][0-2][0-2][0-2][0-2]"[^>]*\/>'
        
        if ($content -match $pathPattern) {
            Write-Host "  Found large black background path - REMOVING" -ForegroundColor Red
            $content = $content -replace $pathPattern, ''
            $filesFixed++
        }
        
        # Pattern 2: Also check for white backgrounds
        $whitePathPattern = '<path d="M0 0[^"]{1000,}" fill="#[Ff]{6}"[^>]*\/>'
        
        if ($content -match $whitePathPattern) {
            Write-Host "  Found large white background path - REMOVING" -ForegroundColor Red
            $content = $content -replace $whitePathPattern, ''
            $filesFixed++
        }
        
        # Pattern 3: Check for rect elements covering the entire canvas
        $rectPattern = '<rect[^>]*width="1024"[^>]*height="1024"[^>]*fill="#0[0-2][0-2][0-2][0-2][0-2]"[^>]*\/>'
        
        if ($content -match $rectPattern) {
            Write-Host "  Found large black background rectangle - REMOVING" -ForegroundColor Red
            $content = $content -replace $rectPattern, ''
            $filesFixed++
        }
        
        # Check if any changes were made
        if ($content -ne $originalContent) {
            # Save the fixed content
            Set-Content -Path $file -Value $content -NoNewline
            Write-Host "  ✓ Fixed and saved!" -ForegroundColor Green
        } else {
            Write-Host "  ✓ No background issues found - file is clean!" -ForegroundColor Green
            $filesSkipped++
        }
        
        Write-Host ""
    } else {
        Write-Host "File not found: $file" -ForegroundColor Red
        Write-Host ""
    }
}

Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Files processed: $($svgFiles.Count)"
Write-Host "Files fixed: $filesFixed"
Write-Host "Files already clean: $filesSkipped"
Write-Host ""
Write-Host "IMPORTANT: This script preserves all character design elements!" -ForegroundColor Yellow
Write-Host "Black elements like shoes, hair, and hoodie outlines are NOT removed." -ForegroundColor Yellow
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Check the sprites in your application"
Write-Host "2. Verify transparent backgrounds"
Write-Host "3. Confirm all character details are intact"
