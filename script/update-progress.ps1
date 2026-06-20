param(
    [Parameter(Mandatory = $true)]
    [string]$Action,
    [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

function Invoke-WithSparklingProgress {
    param(
        [ScriptBlock]$ScriptBlock,
        [array]$ArgumentList = @(),
        [string]$StatusText = "Update in progress..."
    )
    $job = Start-Job -ScriptBlock $ScriptBlock -ArgumentList $ArgumentList
    $colors = @(196, 202, 208, 214, 220, 226, 190, 154, 118, 82, 46, 51, 21, 57, 93, 129, 165, 201)
    $chars = @("#", "@", "%", ".")
    $tick = 0
    while ($job.State -eq "Running") {
        $bar = ""
        for ($i = 0; $i -lt 25; $i++) {
            $color = $colors[($tick + $i) % $colors.Count]
            if ((Get-Random -Minimum 0 -Maximum 10) -eq 0) {
                $bar += "$([char]27)[38;5;231m*"
            } else {
                $charIndex = [math]::Floor(($tick + $i) / 2) % $chars.Count
                $char = $chars[$charIndex]
                $bar += "$([char]27)[38;5;${color}m$char"
            }
        }
        Write-Host -NoNewline "`r$([char]27)[94m[Codyx]$([char]27)[0m $StatusText $bar$([char]27)[0m"
        $tick++
        Start-Sleep -Milliseconds 80
    }
    $res = Receive-Job -Job $job
    Remove-Job -Job $job
    # Clear line
    Write-Host -NoNewline "`r$([char]27)[K"
    return $res
}

$cwd = (Get-Location).Path
$tempFile = [System.IO.Path]::GetTempFileName()

try {
    switch ($Action) {
        "repair" {
            $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
            $backupBranch = "installer-backup-$timestamp"
            $patchPath = Join-Path $env:TEMP "codyx-install-backup-$timestamp.patch"

            Write-Host "$([char]27)[94m[Codyx]$([char]27)[0m Backup branch: $backupBranch"
            
            # Create backup branch
            & git branch $backupBranch 2>$null
            
            # Check if there are tracked modifications
            $trackedChanges = @(& git status --porcelain --untracked-files=no 2>$null | Where-Object { $_ -and $_.Trim() })
            if ($trackedChanges.Count -gt 0) {
                & git diff --binary > $patchPath
                Write-Host "$([char]27)[94m[Codyx]$([char]27)[0m Backup patch: $patchPath"
            }

            # Run reset with progress
            $resetBlock = {
                param($dir, $br, $temp)
                Set-Location $dir
                git reset --hard origin/$br
                $LASTEXITCODE | Set-Content -Path $temp
            }
            $null = Invoke-WithSparklingProgress -ScriptBlock $resetBlock -ArgumentList @($cwd, $Branch, $tempFile) -StatusText "Repairing install checkout..."
            
            $exitCode = Get-Content -Path $tempFile -Raw -ErrorAction SilentlyContinue
            if ($exitCode -eq "0") {
                Write-Host "$([char]27)[94m[Codyx]$([char]27)[0m Repair complete. Install checkout is now in sync."
            } else {
                Write-Host "$([char]27)[91m[Codyx]$([char]27)[0m Repair failed. Re-run install.ps1."
                exit 1
            }
        }
        "pull" {
            $pullBlock = {
                param($dir, $temp)
                Set-Location $dir
                git pull --ff-only
                $LASTEXITCODE | Set-Content -Path $temp
            }
            $null = Invoke-WithSparklingProgress -ScriptBlock $pullBlock -ArgumentList @($cwd, $tempFile) -StatusText "Update in progress..."
            
            $exitCode = Get-Content -Path $tempFile -Raw -ErrorAction SilentlyContinue
            if ($exitCode -eq "0") {
                Write-Host "$([char]27)[94m[Codyx]$([char]27)[0m Update complete. Install checkout is now in sync."
            } else {
                Write-Host "$([char]27)[91m[Codyx]$([char]27)[0m Update failed."
                exit 1
            }
        }
        "npm" {
            $npmBlock = {
                param($temp)
                npm install -g codyx-ai@latest
                $LASTEXITCODE | Set-Content -Path $temp
            }
            $null = Invoke-WithSparklingProgress -ScriptBlock $npmBlock -ArgumentList @($tempFile) -StatusText "Updating codyx-ai..."
            
            $exitCode = Get-Content -Path $tempFile -Raw -ErrorAction SilentlyContinue
            if ($exitCode -eq "0") {
                Write-Host "$([char]27)[94m[Codyx]$([char]27)[0m NPM update complete."
            } else {
                Write-Host "$([char]27)[91m[Codyx]$([char]27)[0m NPM update failed."
                exit 1
            }
        }
    }
} finally {
    if (Test-Path -Path $tempFile) {
        Remove-Item -Path $tempFile -Force -ErrorAction SilentlyContinue
    }
}
