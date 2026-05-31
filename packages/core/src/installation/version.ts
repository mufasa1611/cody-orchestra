declare global {
  const CODY_VERSION: string
  const CODY_CHANNEL: string
}

export const InstallationVersion = typeof CODY_VERSION === "string" ? CODY_VERSION : "local"
export const InstallationChannel = typeof CODY_CHANNEL === "string" ? CODY_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
