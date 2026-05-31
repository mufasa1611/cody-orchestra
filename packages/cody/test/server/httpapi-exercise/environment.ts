import { Flag } from "@cody/core/flag/flag"
import { Effect } from "effect"
import path from "path"

const preserveExerciseGlobalRoot = !!process.env.CODY_HTTPAPI_EXERCISE_GLOBAL
export const exerciseGlobalRoot =
  process.env.CODY_HTTPAPI_EXERCISE_GLOBAL ??
  path.join(process.env.TMPDIR ?? "/tmp", `cody-httpapi-global-${process.pid}`)
process.env.XDG_DATA_HOME = path.join(exerciseGlobalRoot, "data")
process.env.XDG_CONFIG_HOME = path.join(exerciseGlobalRoot, "config")
process.env.XDG_STATE_HOME = path.join(exerciseGlobalRoot, "state")
process.env.XDG_CACHE_HOME = path.join(exerciseGlobalRoot, "cache")
process.env.CODY_DISABLE_SHARE = "true"
export const exerciseConfigDirectory = path.join(exerciseGlobalRoot, "config", "cody")
export const exerciseDataDirectory = path.join(exerciseGlobalRoot, "data", "cody")

const preserveExerciseDatabase = !!process.env.CODY_HTTPAPI_EXERCISE_DB
export const exerciseDatabasePath =
  process.env.CODY_HTTPAPI_EXERCISE_DB ??
  path.join(process.env.TMPDIR ?? "/tmp", `cody-httpapi-exercise-${process.pid}.db`)
process.env.CODY_DB = exerciseDatabasePath
Flag.CODY_DB = exerciseDatabasePath

export const original = {
  CODY_EXPERIMENTAL_HTTPAPI: Flag.CODY_EXPERIMENTAL_HTTPAPI,
  CODY_SERVER_PASSWORD: Flag.CODY_SERVER_PASSWORD,
  CODY_SERVER_USERNAME: Flag.CODY_SERVER_USERNAME,
}

export const cleanupExercisePaths = Effect.promise(async () => {
  const fs = await import("fs/promises")
  if (!preserveExerciseDatabase) {
    await Promise.all(
      [exerciseDatabasePath, `${exerciseDatabasePath}-wal`, `${exerciseDatabasePath}-shm`].map((file) =>
        fs.rm(file, { force: true }).catch(() => undefined),
      ),
    )
  }
  if (!preserveExerciseGlobalRoot)
    await fs.rm(exerciseGlobalRoot, { recursive: true, force: true }).catch(() => undefined)
})
