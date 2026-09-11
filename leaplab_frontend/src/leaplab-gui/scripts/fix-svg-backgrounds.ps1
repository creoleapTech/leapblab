# ============================================================================
# SVG Background Fixer Script
# ============================================================================
# Purpose: Remove black background rectangles from SVG files created by
#          Adobe or other PNG-to-SVG converters
# 
# Usage: .\fix-svg-backgrounds.ps1 [path-to-svg-files]
# Example: .\fix-svg-backgrounds.ps1 "public/assets/sprites/leap/*.svg"
# ============================================================================

param(
    [string]$Path = "public/assets/sprites/leap/*.svg",
    [switch]$Verbose = $false,
    [switch]$DryRun = $false
)

Write-Host "╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                                                                  ║" -ForegroundColor Cyan
Write-Host "║              SVG Black Background Remover                        ║" -ForegroundColor Cyan
Write-Host "║                                                                  ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Get all SVG files
$files = Get-ChildItem $Path -ErrorAction SilentlyContinue

if ($files.Count -eq 0) {
    Write-Host "❌ No SVG files found at: $Path" -ForegroundColor Red
    Write-Host ""
    Write-Host "Usage: .\fix-svg-backgrounds.ps1 [path]" -ForegroundColor Yellow
    Write-Host "Example: .\fix-svg-backgrounds.ps1 'public/assets/sprites/leap/*.svg'" -ForegroundColor Yellow
    exit 1
}

Write-Host "Found $($files.Count) SVG file(s) to process..." -ForegroundColor White
Write-Host ""

$fixedCount = 0
$skippedCount = 0
$errorCount = 0

foreach ($file in $files) {
    try {
        Write-Host "Processing: $($file.Name)" -ForegroundColor Gray
        
        # Read file content
        $content = Get-Content $file.FullName -Raw
        
        # Find the first path closing tag
        $firstPathEnd = $content.IndexOf('z"/>')
        
        if ($firstPathEnd -le 0) {
            Write-Host "  ⚠️  No path elements found" -ForegroundColor Yellow
            $skippedCount++
            continue
        }
        
        # Find the start of this path element
        $searchStart = $content.LastIndexOf('<path', $firstPathEnd)
        
        if ($searchStart -lt 0) {
            Write-Host "  ⚠️  Could not locate path start" -ForegroundColor Yellow
            $skippedCount++
            continue
        }
        
        # Extract the path element
        $pathElement = $content.Substring($searchStart, $firstPathEnd - $searchStart + 4)
        
        # Check if this is a black background path
        $isBlackPath = $pathElement -match 'fill="#000000"'
        $isBackgroundRect = $pathElement -match 'M1025\.000000|M1\.000000'
        
        if ($Verbose) {
            Write-Host "  📋 First path analysis:" -ForegroundColor DarkGray
            Write-Host "     - Is black: $isBlackPath" -ForegroundColor DarkGray
            Write-Host "     - Is background rect: $isBackgroundRect" -ForegroundColor DarkGray
        }
        
        if ($isBlackPath -and $isBackgroundRect) {
            if ($DryRun) {
                Write-Host "  🔍 [DRY RUN] Would remove black background" -ForegroundColor Magenta
                $fixedCount++
            } else {
                # Remove the black background path
                $before = $content.Substring(0, $searchStart)
                $after = $content.Substring($firstPathEnd + 4)
                $newContent = $before + $after
                
                # Save the file
                Set-Content -Path $file.FullName -Value $newContent -NoNewline
                
                Write-Host "  ✅ Removed black background" -ForegroundColor Green
                $fixedCount++
                
                if ($Verbose) {
                    # Show what the first path is now
                    $newFirstPathEnd = $newContent.IndexOf('z"/>')
                    if ($newFirstPathEnd -gt 0) {
                        $newFirstPathStart = $newContent.LastIndexOf('<path', $newFirstPathEnd)
                        $newFirstPath = $newContent.Substring($newFirstPathStart, 
                                        [Math]::Min(100, $newFirstPathEnd - $newFirstPathStart))
                        Write-Host "     New first path: $newFirstPath..." -ForegroundColor DarkGray
                    }
                }
            }
        } else {
            Write-Host "  ℹ️  No black background found (already clean)" -ForegroundColor Blue
            $skippedCount++
        }
        
    } catch {
        Write-Host "  ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
        $errorCount++
    }
    
    Write-Host ""
}

# Summary
Write-Host "╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                          SUMMARY                                 ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Total files processed: $($files.Count)" -ForegroundColor White
Write-Host "  ✅ Fixed: $fixedCount" -ForegroundColor Green
Write-Host "  ℹ️  Skipped (already clean): $skippedCount" -ForegroundColor Blue
Write-Host "  ❌ Errors: $errorCount" -ForegroundColor Red
Write-Host ""

if ($DryRun) {
    Write-Host "  🔍 This was a DRY RUN - no files were modified" -ForegroundColor Magenta
    Write-Host "  Run without -DryRun to apply changes" -ForegroundColor Magenta
    Write-Host ""
}

if ($fixedCount -gt 0 -and -not $DryRun) {
    Write-Host "  🎉 Success! All black backgrounds removed." -ForegroundColor Green
    Write-Host "  💡 Tip: Test the sprites in your application to verify transparency" -ForegroundColor Yellow
    Write-Host ""
}

# Exit code
if ($errorCount -gt 0) {
    exit 1
} else {
    exit 0
}
