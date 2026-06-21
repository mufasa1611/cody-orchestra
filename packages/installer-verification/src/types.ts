export interface Bindings {
  InstallerVerificationDatabase: D1Database
  INSTALLER_RECEIPT_SECRET: string
  INSTALLER_OTP_PEPPER: string
  INSTALLER_ADMIN_SECRET: string
  INSTALLER_MAILGUN_SENDING_KEY: string
  INSTALLER_ENVIRONMENT: string
  INSTALLER_SENDER: string
  INSTALLER_PRIVACY_EMAIL: string
  INSTALLER_MAILGUN_API_BASE: string
  INSTALLER_MAILGUN_DOMAIN: string
  INSTALLER_ADMIN_EMAIL?: string
  INSTALLER_TEST_CODE?: string
}

export interface ChallengeRow {
  id: string
  install_id: string
  display_name: string
  email: string
  email_hash: string
  code_hash: string
  installer_version: string
  platform: string
  machine_id: string | null
  attempts: number
  created_at: number
  last_sent_at: number
  expires_at: number
  verified_at: number | null
}

export interface ReceiptPayload {
  install_id: string
  receipt_id: string
  issued_at: number
  expires_at: number
}

export interface RemoteCommandRow {
  id: string
  install_id: string
  type: string
  status: string
  created_at: number
  acknowledged_at: number | null
  completed_at: number | null
  retain_until: number
}

export interface BannedMachineRow {
  id: string
  machine_id: string
  reason: string | null
  banned_by: string | null
  created_at: number
  retain_until: number
}
