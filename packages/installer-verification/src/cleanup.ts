import { cleanup } from "./db"

interface CleanupEnv {
  InstallerVerificationDatabase: D1Database
}

export default {
  async scheduled(_controller: ScheduledController, env: CleanupEnv) {
    await cleanup(env.InstallerVerificationDatabase)
  },
}
