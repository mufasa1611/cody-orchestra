import { $ } from "bun"

await $`bun ./scripts/copy-icons.ts ${process.env.CODY_CHANNEL ?? "dev"}`

await $`cd ../cody && bun script/build.ts`