import "sst"

declare module "sst" {
  export interface Resource {
    INSTALLER_RECEIPT_SECRET: {
      type: "sst.sst.Secret"
      value: string
    }
    INSTALLER_OTP_PEPPER: {
      type: "sst.sst.Secret"
      value: string
    }
    INSTALLER_ADMIN_SECRET: {
      type: "sst.sst.Secret"
      value: string
    }
    INSTALLER_MAILGUN_SENDING_KEY: {
      type: "sst.sst.Secret"
      value: string
    }
  }
}
