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
