const database = new sst.cloudflare.D1("InstallerVerificationDatabase")
const ipRateLimit = new sst.cloudflare.RateLimit("InstallerVerificationIpRateLimit", {
  namespaceId: 3101,
  limit: 10,
  period: "1 minute",
})
const receiptSecret = new sst.Secret("INSTALLER_RECEIPT_SECRET")
const otpPepper = new sst.Secret("INSTALLER_OTP_PEPPER")
const adminSecret = new sst.Secret("INSTALLER_ADMIN_SECRET")
const mailgunSendingKey = new sst.Secret("INSTALLER_MAILGUN_SENDING_KEY")

const hostname =
  $app.stage === "production"
    ? "install.kingkung.men"
    : $app.stage === "installer-staging"
      ? "install-staging.kingkung.men"
      : `install-${$app.stage}.kingkung.men`

export const installerVerification = new sst.cloudflare.Worker("InstallerVerification", {
  handler: "packages/installer-verification/src/index.ts",
  domain: {
    name: hostname,
    dns: sst.cloudflare.dns(),
  },
  url: true,
  compatibility: {
    date: "2026-06-13",
    flags: ["nodejs_compat"],
  },
  environment: {
    INSTALLER_ENVIRONMENT: $app.stage,
    INSTALLER_SENDER: "Codyx Installer <installer@verification.kingkung.men>",
    INSTALLER_PRIVACY_EMAIL: "privacy@kingkung.men",
    INSTALLER_MAILGUN_API_BASE: "https://api.eu.mailgun.net",
    INSTALLER_MAILGUN_DOMAIN: "verification.kingkung.men",
  },
  link: [
    database,
    ipRateLimit,
    receiptSecret,
    otpPepper,
    adminSecret,
    mailgunSendingKey,
  ],
  transform: {
    worker: (args) => {
      args.observability = {
        enabled: true,
        headSamplingRate: 1,
      }
    },
  },
})

new sst.cloudflare.Cron("InstallerVerificationCleanup", {
  schedules: ["17 3 * * *"],
  worker: {
    handler: "packages/installer-verification/src/cleanup.ts",
    link: [database],
    compatibility: {
      date: "2026-06-13",
      flags: ["nodejs_compat"],
    },
  },
})
