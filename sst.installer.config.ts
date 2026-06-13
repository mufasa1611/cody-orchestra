/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "cody-installer",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: input?.stage === "production",
      home: "cloudflare",
    }
  },
  async run() {
    const { installerVerification } = await import("./infra/installer-verification.js")
    return {
      url: installerVerification.url,
    }
  },
})
