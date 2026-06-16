param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerVersion,
  [string]$ServiceUrl = "https://install.kingkung.men",
  [string]$ReceiptPath = (Join-Path $env:LOCALAPPDATA "codyx-installer\verification.json"),
  [switch]$NonInteractive,
  [scriptblock]$RequestAction,
  [scriptblock]$ReadAction = { param($Prompt) Read-Host $Prompt },
  [scriptblock]$SleepAction = { param($Seconds) Start-Sleep -Seconds $Seconds }
)

$ErrorActionPreference = "Stop"

function Write-VerificationStep($Message) {
  Write-Host ">> $Message" -ForegroundColor Cyan
}

function Write-VerificationOk($Message) {
  Write-Host "[ok] $Message" -ForegroundColor Green
}

function Write-VerificationWarn($Message) {
  Write-Host "[warn] $Message" -ForegroundColor Yellow
}

function Write-VerificationError($Message) {
  Write-Host "[error] $Message" -ForegroundColor Red
}

function New-VerificationResult($Success, $Status) {
  return [pscustomobject]@{
    Success = [bool]$Success
    Status = $Status
  }
}

function Test-InstallId($Value) {
  $parsed = [guid]::Empty
  return $Value -and [guid]::TryParse([string]$Value, [ref]$parsed)
}

function Test-EmailAddress($Value) {
  if (-not $Value -or $Value.Length -gt 254) { return $false }
  try {
    $address = [System.Net.Mail.MailAddress]::new($Value)
    return $address.Address.Equals($Value, [System.StringComparison]::OrdinalIgnoreCase)
  } catch {
    return $false
  }
}

function Get-ErrorResponse($ErrorRecord) {
  $statusCode = 0
  $retryAfter = $null
  try {
    $statusCode = [int]$ErrorRecord.Exception.Response.StatusCode
    $retryAfter = $ErrorRecord.Exception.Response.Headers["Retry-After"]
  } catch {}

  $code = "request_failed"
  $message = "The verification service could not process the request."
  try {
    $details = $ErrorRecord.ErrorDetails.Message | ConvertFrom-Json
    if ($details.error) { $code = [string]$details.error }
    if ($details.message) { $message = [string]$details.message }
  } catch {
    if ($ErrorRecord.Exception.Message) { $message = $ErrorRecord.Exception.Message }
  }

  return [pscustomobject]@{
    Success = $false
    StatusCode = $statusCode
    Code = $code
    Message = $message
    RetryAfter = $retryAfter
    Transient = ($statusCode -eq 0 -or $statusCode -eq 408 -or $statusCode -ge 500)
  }
}

if (-not $RequestAction) {
  $RequestAction = {
    param($Method, $Uri, $Body)
    try {
      $parameters = @{
        Uri = $Uri
        Method = $Method
        TimeoutSec = 20
        Headers = @{ Accept = "application/json" }
      }
      if ($null -ne $Body) {
        $parameters.ContentType = "application/json"
        $parameters.Body = $Body | ConvertTo-Json -Depth 5 -Compress
      }
      $response = Invoke-RestMethod @parameters
      return [pscustomobject]@{
        Success = $true
        StatusCode = 200
        Body = $response
        Code = $null
        Message = $null
        RetryAfter = $null
        Transient = $false
      }
    } catch {
      return Get-ErrorResponse $_
    }
  }
}

function Invoke-VerificationApi($Method, $Path, $Body = $null) {
  $backoff = 1
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $result = & $RequestAction $Method "$($ServiceUrl.TrimEnd('/'))$Path" $Body
    if ($result.Success -or -not $result.Transient) { return $result }
    if ($attempt -lt 3) {
      Write-VerificationWarn "Verification service unavailable (attempt $attempt/3). Retrying..."
      & $SleepAction $backoff
      $backoff = [Math]::Min($backoff * 2, 4)
    }
  }
  return $result
}

function Read-InstallerValue($Prompt) {
  return [string](& $ReadAction $Prompt)
}

function Save-VerificationReceipt($InstallId, $Receipt, $ExpiresAt) {
  $directory = Split-Path -Parent $ReceiptPath
  $null = New-Item -ItemType Directory -Force -Path $directory
  $temporary = "$ReceiptPath.tmp"
  @{
    version = 1
    install_id = $InstallId
    receipt = $Receipt
    expires_at = $ExpiresAt
    server_url = $ServiceUrl
  } | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
  Move-Item -LiteralPath $temporary -Destination $ReceiptPath -Force
}

function Read-VerificationState {
  if (-not (Test-Path -LiteralPath $ReceiptPath)) { return $null }
  try {
    return Get-Content -LiteralPath $ReceiptPath -Raw | ConvertFrom-Json
  } catch {
    Write-VerificationWarn "The saved installer verification receipt is unreadable. A new one is required."
    return $null
  }
}

function Stop-ForServiceFailure($Result) {
  $message = if ($Result.Message) { $Result.Message } else { "The verification service is unavailable." }
  Write-VerificationError $message
  if ($Result.Transient) {
    Write-VerificationError "Git and Bun will remain installed. Rerun the installer when the service is available."
    return New-VerificationResult $false "service_unavailable"
  }
  if ($Result.RetryAfter) {
    Write-VerificationWarn "Try again after $($Result.RetryAfter) seconds."
  } else {
    Write-VerificationWarn "Correct the information or wait before rerunning the installer."
  }
  return New-VerificationResult $false "verification_failed"
}

$state = Read-VerificationState
$installId = if ($state -and (Test-InstallId $state.install_id)) {
  [string]$state.install_id
} else {
  [guid]::NewGuid().ToString()
}

if ($state -and $state.receipt -and (Test-InstallId $state.install_id)) {
  Write-VerificationStep "Checking saved installer verification..."
  $validation = Invoke-VerificationApi "POST" "/v1/receipts/validate" @{
    install_id = $installId
    receipt = [string]$state.receipt
    installer_version = $InstallerVersion
    platform = "windows"
  }
  if (-not $validation.Success) { return Stop-ForServiceFailure $validation }
  if ($validation.Body.valid) {
    Write-VerificationOk "Email verification receipt is valid."
    return New-VerificationResult $true "valid_receipt"
  }
  Write-VerificationWarn "The saved verification has expired or was revoked."
}

if ($NonInteractive) {
  Write-VerificationError "Email verification is required before installation can continue."
  Write-VerificationError "Run the installer in an interactive PowerShell window and enter the emailed code."
  return New-VerificationResult $false "interaction_required"
}

Write-Host ""
Write-Host "Installer email verification" -ForegroundColor Cyan
Write-Host "Codyx collects your display name and email address to verify email ownership and send"
Write-Host "essential installer, service, or security notices. Your display name is not independently"
Write-Host "verified. This information is not used for marketing."
Write-Host "No source code, prompts, project content, or model conversations are collected by this step."
Write-Host "Verified registration data is retained for up to 24 months."
Write-Host "Privacy: https://install.kingkung.men/privacy"
Write-Host "Deletion requests: privacy@kingkung.men"
Write-Host "wish you smooth installation (Mufasa)"
Write-Host ""

$displayName = $null
$email = $null

while ($true) {
  while (-not $displayName) {
    $value = (Read-InstallerValue "Display name (or 'cancel')").Trim()
    if ($value.Equals("cancel", [System.StringComparison]::OrdinalIgnoreCase)) {
      Write-VerificationWarn "Installation cancelled before registration."
      return New-VerificationResult $false "cancelled"
    }
    if ($value.Length -lt 2 -or $value.Length -gt 100) {
      Write-VerificationWarn "Enter a display name between 2 and 100 characters."
      continue
    }
    $displayName = $value
  }

  while (-not $email) {
    $value = (Read-InstallerValue "Email address (or 'cancel')").Trim()
    if ($value.Equals("cancel", [System.StringComparison]::OrdinalIgnoreCase)) {
      Write-VerificationWarn "Installation cancelled before registration."
      return New-VerificationResult $false "cancelled"
    }
    if (-not (Test-EmailAddress $value)) {
      Write-VerificationWarn "Enter a valid email address."
      continue
    }
    $email = $value.ToLowerInvariant()
  }

  Write-VerificationStep "Sending a verification code to $email..."
  $challenge = Invoke-VerificationApi "POST" "/v1/challenges" @{
    install_id = $installId
    display_name = $displayName
    email = $email
    installer_version = $InstallerVersion
    platform = "windows"
  }
  if (-not $challenge.Success) { return Stop-ForServiceFailure $challenge }
  $challengeId = [string]$challenge.Body.challenge_id
  Write-VerificationOk "Verification code sent. It expires in 10 minutes."

  $changeEmail = $false
  while (-not $changeEmail) {
    $inputValue = (Read-InstallerValue "Enter code, resend, change-email, retry, or cancel").Trim()
    $command = $inputValue.ToLowerInvariant()

    if ($command -eq "cancel") {
      Write-VerificationWarn "Installation cancelled before verification."
      return New-VerificationResult $false "cancelled"
    }
    if ($command -eq "change-email") {
      $email = $null
      $changeEmail = $true
      continue
    }
    if ($command -eq "resend") {
      $resent = Invoke-VerificationApi "POST" "/v1/challenges/$challengeId/resend"
      if ($resent.Success) {
        Write-VerificationOk "A new code was sent."
      } elseif ($resent.Code -eq "resend_too_soon") {
        $wait = if ($resent.RetryAfter) { " Wait $($resent.RetryAfter) seconds." } else { "" }
        Write-VerificationWarn "$($resent.Message)$wait"
      } elseif ($resent.Transient) {
        return Stop-ForServiceFailure $resent
      } else {
        Write-VerificationWarn $resent.Message
      }
      continue
    }

    if ($command -eq "retry") {
      $inputValue = (Read-InstallerValue "Enter the six-digit code to retry").Trim()
    }
    if ($inputValue -notmatch "^\d{6}$") {
      Write-VerificationWarn "Enter the six-digit code or one of the listed commands."
      continue
    }

    $verified = Invoke-VerificationApi "POST" "/v1/challenges/$challengeId/verify" @{
      code = $inputValue
    }
    if ($verified.Success) {
      Save-VerificationReceipt $installId $verified.Body.receipt $verified.Body.expires_at
      Write-VerificationOk "Email ownership verified. Installation can continue."
      return New-VerificationResult $true "verified"
    }
    if ($verified.Transient) { return Stop-ForServiceFailure $verified }

    switch ($verified.Code) {
      "incorrect_code" { Write-VerificationWarn "That code is incorrect. Try again." }
      "code_expired" { Write-VerificationWarn "That code expired. Type 'resend' for a new code." }
      "attempts_exhausted" { Write-VerificationWarn "Too many incorrect attempts. Type 'resend' for a new code." }
      default { Write-VerificationWarn $verified.Message }
    }
  }
}
