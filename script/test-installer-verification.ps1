param()

$ErrorActionPreference = "Stop"
$Helper = Join-Path $PSScriptRoot "installer-verification.ps1"
$failures = [System.Collections.Generic.List[string]]::new()
$checks = 0

function global:Assert-True($Condition, $Message) {
  $script:checks++
  if (-not $Condition) { throw $Message }
}

function New-TestDirectory {
  $path = Join-Path $env:TEMP "codyx-installer-verification-$([guid]::NewGuid())"
  $null = New-Item -ItemType Directory -Force -Path $path
  return $path
}

function Invoke-Test($Name, [scriptblock]$Body) {
  try {
    & $Body
    Write-Host "[ok] $Name" -ForegroundColor Green
  } catch {
    $script:failures.Add("$Name`: $($_.Exception.Message)")
    Write-Host "[fail] $Name" -ForegroundColor Red
  }
}

function global:New-Success($Body) {
  return [pscustomobject]@{
    Success = $true
    StatusCode = 200
    Body = $Body
    Code = $null
    Message = $null
    RetryAfter = $null
    Transient = $false
  }
}

function global:New-Failure($Code, $Message, $Transient = $false, $RetryAfter = $null) {
  return [pscustomobject]@{
    Success = $false
    StatusCode = if ($Transient) { 503 } else { 409 }
    Body = $null
    Code = $Code
    Message = $Message
    RetryAfter = $RetryAfter
    Transient = $Transient
  }
}

Invoke-Test "valid cached receipt continues without prompting" {
  $directory = New-TestDirectory
  try {
    $receiptPath = Join-Path $directory "verification.json"
    $installId = [guid]::NewGuid().ToString()
    @{ version = 1; install_id = $installId; receipt = "saved.receipt"; expires_at = "2027-01-01T00:00:00Z" } |
      ConvertTo-Json | Set-Content -LiteralPath $receiptPath
    $state = @{ requests = 0 }
    $request = {
      param($Method, $Uri, $Body)
      $state.requests++
      Assert-True ($Method -eq "POST") "Receipt validation must use POST."
      Assert-True ([uri]$Uri).AbsolutePath.Equals("/v1/receipts/validate") "Unexpected validation path."
      Assert-True ($Body.install_id -eq $installId) "Validation did not use the saved installation ID."
      return New-Success ([pscustomobject]@{ valid = $true; expires_at = "2027-01-01T00:00:00Z" })
    }.GetNewClosure()
    $result = & $Helper -InstallerVersion "test" -ReceiptPath $receiptPath -NonInteractive `
      -RequestAction $request -ReadAction { throw "Prompt was not expected." }
    Assert-True $result.Success "A valid saved receipt should continue."
    Assert-True ($result.Status -eq "valid_receipt") "Expected valid_receipt status."
    Assert-True ($state.requests -eq 1) "Expected one receipt validation request."
  } finally {
    Remove-Item -LiteralPath $directory -Recurse -Force
  }
}

Invoke-Test "first verification saves only receipt metadata" {
  $directory = New-TestDirectory
  try {
    $receiptPath = Join-Path $directory "verification.json"
    $inputs = [System.Collections.Generic.Queue[string]]::new()
    @("Installer User", "user@example.com", "retry", "246810") | ForEach-Object { $inputs.Enqueue($_) }
    $read = { param($Prompt) return $inputs.Dequeue() }.GetNewClosure()
    $state = @{ challenge = $null; verifies = 0 }
    $request = {
      param($Method, $Uri, $Body)
      $path = ([uri]$Uri).AbsolutePath
      if ($path -eq "/v1/challenges") {
        $state.challenge = $Body
        return New-Success ([pscustomobject]@{ challenge_id = "challenge-1" })
      }
      if ($path -eq "/v1/challenges/challenge-1/verify") {
        $state.verifies++
        Assert-True ($Body.code -eq "246810") "The entered code was not submitted."
        return New-Success ([pscustomobject]@{ receipt = "new.receipt"; expires_at = "2027-01-01T00:00:00Z" })
      }
      throw "Unexpected request path: $path"
    }.GetNewClosure()
    $result = & $Helper -InstallerVersion "test" -ReceiptPath $receiptPath `
      -RequestAction $request -ReadAction $read
    Assert-True $result.Success "First verification should succeed."
    Assert-True ($state.challenge.display_name -eq "Installer User") "Display name was not submitted."
    Assert-True ($state.challenge.email -eq "user@example.com") "Email was not submitted."
    Assert-True ($state.verifies -eq 1) "Expected one code verification request."
    $saved = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
    $properties = @($saved.psobject.Properties.Name | Sort-Object)
    Assert-True (($properties -join ",") -eq "expires_at,install_id,receipt,version") "Receipt file contains unexpected fields."
    Assert-True ($saved.receipt -eq "new.receipt") "Receipt was not saved."
  } finally {
    Remove-Item -LiteralPath $directory -Recurse -Force
  }
}

Invoke-Test "wrong and expired codes can recover" {
  $directory = New-TestDirectory
  try {
    $receiptPath = Join-Path $directory "verification.json"
    $inputs = [System.Collections.Generic.Queue[string]]::new()
    @("Installer User", "user@example.com", "111111", "222222", "resend", "333333") |
      ForEach-Object { $inputs.Enqueue($_) }
    $read = { param($Prompt) return $inputs.Dequeue() }.GetNewClosure()
    $state = @{ verify = 0; resend = 0 }
    $request = {
      param($Method, $Uri, $Body)
      $path = ([uri]$Uri).AbsolutePath
      if ($path -eq "/v1/challenges") {
        return New-Success ([pscustomobject]@{ challenge_id = "challenge-2" })
      }
      if ($path -eq "/v1/challenges/challenge-2/resend") {
        $state.resend++
        return New-Success ([pscustomobject]@{ expires_at = "2027-01-01T00:00:00Z" })
      }
      if ($path -eq "/v1/challenges/challenge-2/verify") {
        $state.verify++
        if ($Body.code -eq "111111") { return New-Failure "incorrect_code" "Incorrect code." }
        if ($Body.code -eq "222222") { return New-Failure "code_expired" "Code expired." }
        return New-Success ([pscustomobject]@{ receipt = "recovered.receipt"; expires_at = "2027-01-01T00:00:00Z" })
      }
      throw "Unexpected request path: $path"
    }.GetNewClosure()
    $result = & $Helper -InstallerVersion "test" -ReceiptPath $receiptPath `
      -RequestAction $request -ReadAction $read
    Assert-True $result.Success "Verification should recover after wrong and expired codes."
    Assert-True ($state.verify -eq 3) "Expected three verification attempts."
    Assert-True ($state.resend -eq 1) "Expected one resend request."
  } finally {
    Remove-Item -LiteralPath $directory -Recurse -Force
  }
}

Invoke-Test "resend command sends a fresh code" {
  $directory = New-TestDirectory
  try {
    $receiptPath = Join-Path $directory "verification.json"
    $inputs = [System.Collections.Generic.Queue[string]]::new()
    @("Installer User", "user@example.com", "resend", "246810") | ForEach-Object { $inputs.Enqueue($_) }
    $read = { param($Prompt) return $inputs.Dequeue() }.GetNewClosure()
    $state = @{ resend = 0 }
    $request = {
      param($Method, $Uri, $Body)
      $path = ([uri]$Uri).AbsolutePath
      if ($path -eq "/v1/challenges") {
        return New-Success ([pscustomobject]@{ challenge_id = "challenge-3" })
      }
      if ($path -eq "/v1/challenges/challenge-3/resend") {
        $state.resend++
        return New-Success ([pscustomobject]@{ expires_at = "2027-01-01T00:00:00Z" })
      }
      if ($path -eq "/v1/challenges/challenge-3/verify") {
        return New-Success ([pscustomobject]@{ receipt = "resent.receipt"; expires_at = "2027-01-01T00:00:00Z" })
      }
      throw "Unexpected request path: $path"
    }.GetNewClosure()
    $result = & $Helper -InstallerVersion "test" -ReceiptPath $receiptPath `
      -RequestAction $request -ReadAction $read
    Assert-True $result.Success "Verification after resend should succeed."
    Assert-True ($state.resend -eq 1) "Resend endpoint was not called once."
  } finally {
    Remove-Item -LiteralPath $directory -Recurse -Force
  }
}

Invoke-Test "change-email requests a challenge for the corrected address" {
  $directory = New-TestDirectory
  try {
    $receiptPath = Join-Path $directory "verification.json"
    $inputs = [System.Collections.Generic.Queue[string]]::new()
    @("Installer User", "wrong@example.com", "change-email", "right@example.com", "246810") |
      ForEach-Object { $inputs.Enqueue($_) }
    $read = { param($Prompt) return $inputs.Dequeue() }.GetNewClosure()
    $state = @{ emails = [System.Collections.Generic.List[string]]::new() }
    $request = {
      param($Method, $Uri, $Body)
      $path = ([uri]$Uri).AbsolutePath
      if ($path -eq "/v1/challenges") {
        $state.emails.Add([string]$Body.email)
        return New-Success ([pscustomobject]@{ challenge_id = "challenge-$($state.emails.Count)" })
      }
      if ($path -eq "/v1/challenges/challenge-2/verify") {
        return New-Success ([pscustomobject]@{ receipt = "corrected.receipt"; expires_at = "2027-01-01T00:00:00Z" })
      }
      throw "Unexpected request path: $path"
    }.GetNewClosure()
    $result = & $Helper -InstallerVersion "test" -ReceiptPath $receiptPath `
      -RequestAction $request -ReadAction $read
    Assert-True $result.Success "Corrected email verification should succeed."
    Assert-True (($state.emails -join ",") -eq "wrong@example.com,right@example.com") "Corrected email was not used."
  } finally {
    Remove-Item -LiteralPath $directory -Recurse -Force
  }
}

Invoke-Test "cancel stops before contacting the service" {
  $directory = New-TestDirectory
  try {
    $receiptPath = Join-Path $directory "verification.json"
    $state = @{ requests = 0 }
    $request = {
      param($Method, $Uri, $Body)
      $state.requests++
      throw "Service should not be contacted."
    }.GetNewClosure()
    $result = & $Helper -InstallerVersion "test" -ReceiptPath $receiptPath `
      -RequestAction $request -ReadAction { param($Prompt) return "cancel" }
    Assert-True (-not $result.Success) "Cancellation should not succeed."
    Assert-True ($result.Status -eq "cancelled") "Expected cancelled status."
    Assert-True ($state.requests -eq 0) "Cancellation contacted the service."
  } finally {
    Remove-Item -LiteralPath $directory -Recurse -Force
  }
}

Invoke-Test "noninteractive run without a receipt stops before contacting the service" {
  $directory = New-TestDirectory
  try {
    $receiptPath = Join-Path $directory "verification.json"
    $state = @{ requests = 0 }
    $request = {
      param($Method, $Uri, $Body)
      $state.requests++
      throw "Service should not be contacted."
    }.GetNewClosure()
    $result = & $Helper -InstallerVersion "test" -ReceiptPath $receiptPath -NonInteractive `
      -RequestAction $request -ReadAction { throw "Prompt was not expected." }
    Assert-True (-not $result.Success) "Noninteractive verification without a receipt should fail."
    Assert-True ($result.Status -eq "interaction_required") "Expected interaction_required status."
    Assert-True ($state.requests -eq 0) "Noninteractive refusal contacted the service."
  } finally {
    Remove-Item -LiteralPath $directory -Recurse -Force
  }
}

Invoke-Test "service outage retries three times and stops" {
  $directory = New-TestDirectory
  try {
    $receiptPath = Join-Path $directory "verification.json"
    $inputs = [System.Collections.Generic.Queue[string]]::new()
    @("Installer User", "user@example.com") | ForEach-Object { $inputs.Enqueue($_) }
    $read = { param($Prompt) return $inputs.Dequeue() }.GetNewClosure()
    $state = @{ requests = 0; sleeps = 0 }
    $request = {
      param($Method, $Uri, $Body)
      $state.requests++
      return New-Failure "service_unavailable" "Service unavailable." $true
    }.GetNewClosure()
    $sleep = { param($Seconds) $state.sleeps++ }.GetNewClosure()
    $result = & $Helper -InstallerVersion "test" -ReceiptPath $receiptPath `
      -RequestAction $request -ReadAction $read -SleepAction $sleep
    Assert-True (-not $result.Success) "Service outage should stop installation."
    Assert-True ($result.Status -eq "service_unavailable") "Expected service_unavailable status."
    Assert-True ($state.requests -eq 3) "Service outage should make three attempts."
    Assert-True ($state.sleeps -eq 2) "Service outage should back off twice."
  } finally {
    Remove-Item -LiteralPath $directory -Recurse -Force
  }
}

if ($failures.Count -gt 0) {
  Write-Host ""
  Write-Host "$($failures.Count) verification tests failed:" -ForegroundColor Red
  $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}

Write-Host ""
Write-Host "All 8 verification scenarios passed ($checks assertions)." -ForegroundColor Green
