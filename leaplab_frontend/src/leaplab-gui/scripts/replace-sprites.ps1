# Sprite Replacement Helper Script
# This script helps you replace sprites in bulk

Write-Host "╔═══════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║          SPRITE REPLACEMENT HELPER                            ║" -ForegroundColor Cyan
Write-Host "╚═══════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$spritesDir = "public/assets/sprites/leap"
$backupDir = "public/assets/sprites/leap_backup"

# Function to list all current sprites
function List-CurrentSprites {
    Write-Host "Current Sprites:" -ForegroundColor Yellow
    Write-Host ""
    
    $sprites = Get-ChildItem "$spritesDir/*.svg" | ForEach-Object {
        $name = $_.Name -replace '_.*', ''
        $name
    } | Sort-Object -Unique
    
    $count = 0
    foreach ($sprite in $sprites) {
        $files = Get-ChildItem "$spritesDir/$sprite*.svg"
        $count++
        Write-Host "  $count. $sprite ($($files.Count) costumes)" -ForegroundColor White
    }
    
    Write-Host ""
    Write-Host "Total: $count sprites" -ForegroundColor Green
    Write-Host ""
}

# Function to backup sprites
function Backup-Sprites {
    Write-Host "Backing up sprites..." -ForegroundColor Yellow
    
    if (-not (Test-Path $backupDir)) {
        New-Item -ItemType Directory -Path $backupDir | Out-Null
    }
    
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupFolder = "$backupDir/backup_$timestamp"
    New-Item -ItemType Directory -Path $backupFolder | Out-Null
    
    Copy-Item "$spritesDir/*.svg" $backupFolder -ErrorAction SilentlyContinue
    Copy-Item "$spritesDir/*.png" $backupFolder -ErrorAction SilentlyContinue
    
    Write-Host "Backup created: $backupFolder" -ForegroundColor Green
    Write-Host ""
}

# Function to replace a single sprite
function Replace-Sprite {
    param(
        [string]$spriteName,
        [string]$sourcePath
    )
    
    Write-Host "Replacing sprite: $spriteName" -ForegroundColor Yellow
    
    # Check if source files exist
    $sourceFiles = Get-ChildItem "$sourcePath/${spriteName}_${spriteName}-*.svg"
    
    if ($sourceFiles.Count -eq 0) {
        Write-Host "  ERROR: No source files found in $sourcePath" -ForegroundColor Red
        return $false
    }
    
    Write-Host "  Found $($sourceFiles.Count) costume files" -ForegroundColor Gray
    
    # Delete old files
    $oldFiles = Get-ChildItem "$spritesDir/${spriteName}_${spriteName}-*.svg" -ErrorAction SilentlyContinue
    if ($oldFiles) {
        Write-Host "  Deleting $($oldFiles.Count) old files..." -ForegroundColor Gray
        $oldFiles | Remove-Item
    }
    
    # Copy new files
    Write-Host "  Copying new files..." -ForegroundColor Gray
    Copy-Item $sourceFiles $spritesDir
    
    Write-Host "  SUCCESS: $spriteName replaced!" -ForegroundColor Green
    Write-Host ""
    return $true
}

# Function to verify sprite files
function Verify-Sprite {
    param([string]$spriteName)
    
    $files = Get-ChildItem "$spritesDir/${spriteName}_${spriteName}-*.svg"
    
    if ($files.Count -eq 0) {
        Write-Host "  ERROR: No files found for $spriteName" -ForegroundColor Red
        return $false
    }
    
    Write-Host "  $spriteName: $($files.Count) costumes" -ForegroundColor Green
    
    # Check file sizes
    foreach ($file in $files) {
        $sizeKB = [math]::Round($file.Length / 1KB, 2)
        if ($sizeKB -gt 500) {
            Write-Host "    WARNING: $($file.Name) is large ($sizeKB KB)" -ForegroundColor Yellow
        }
    }
    
    return $true
}

# Main menu
function Show-Menu {
    Write-Host "What would you like to do?" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  1. List current sprites" -ForegroundColor White
    Write-Host "  2. Backup all sprites" -ForegroundColor White
    Write-Host "  3. Replace a single sprite" -ForegroundColor White
    Write-Host "  4. Replace multiple sprites" -ForegroundColor White
    Write-Host "  5. Verify sprite files" -ForegroundColor White
    Write-Host "  6. Exit" -ForegroundColor White
    Write-Host ""
}

# Main loop
do {
    Show-Menu
    $choice = Read-Host "Enter choice (1-6)"
    Write-Host ""
    
    switch ($choice) {
        "1" {
            List-CurrentSprites
            Read-Host "Press Enter to continue"
        }
        "2" {
            Backup-Sprites
            Read-Host "Press Enter to continue"
        }
        "3" {
            $spriteName = Read-Host "Enter sprite name (e.g., 'ada')"
            $sourcePath = Read-Host "Enter source folder path"
            
            if (Test-Path $sourcePath) {
                Replace-Sprite -spriteName $spriteName -sourcePath $sourcePath
            } else {
                Write-Host "ERROR: Source path not found" -ForegroundColor Red
            }
            
            Read-Host "Press Enter to continue"
        }
        "4" {
            $sourcePath = Read-Host "Enter source folder path (containing all new sprites)"
            
            if (-not (Test-Path $sourcePath)) {
                Write-Host "ERROR: Source path not found" -ForegroundColor Red
                Read-Host "Press Enter to continue"
                continue
            }
            
            # Get list of sprites to replace
            $newSprites = Get-ChildItem "$sourcePath/*.svg" | ForEach-Object {
                $_.Name -replace '_.*', ''
            } | Sort-Object -Unique
            
            Write-Host "Found $($newSprites.Count) sprites to replace:" -ForegroundColor Yellow
            foreach ($sprite in $newSprites) {
                Write-Host "  - $sprite" -ForegroundColor White
            }
            Write-Host ""
            
            $confirm = Read-Host "Replace all these sprites? (yes/no)"
            
            if ($confirm -eq "yes") {
                Backup-Sprites
                
                $successCount = 0
                foreach ($sprite in $newSprites) {
                    if (Replace-Sprite -spriteName $sprite -sourcePath $sourcePath) {
                        $successCount++
                    }
                }
                
                Write-Host "Replaced $successCount of $($newSprites.Count) sprites" -ForegroundColor Green
            } else {
                Write-Host "Operation cancelled" -ForegroundColor Yellow
            }
            
            Read-Host "Press Enter to continue"
        }
        "5" {
            Write-Host "Verifying sprite files..." -ForegroundColor Yellow
            Write-Host ""
            
            $sprites = Get-ChildItem "$spritesDir/*.svg" | ForEach-Object {
                $_.Name -replace '_.*', ''
            } | Sort-Object -Unique
            
            foreach ($sprite in $sprites) {
                Verify-Sprite -spriteName $sprite
            }
            
            Read-Host "Press Enter to continue"
        }
        "6" {
            Write-Host "Goodbye!" -ForegroundColor Cyan
        }
        default {
            Write-Host "Invalid choice" -ForegroundColor Red
            Read-Host "Press Enter to continue"
        }
    }
    
    Write-Host ""
    
} while ($choice -ne "6")
