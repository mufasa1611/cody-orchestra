import { describe, expect, test } from "bun:test"
import { name } from "../../../../src/cli/cmd/tui/util/model"

describe("TUI model display names", () => {
  test("uses cosmetic Sandra labels without changing lookup ids", () => {
    expect(name(undefined, "opencode", "big-pickle")).toBe("Sandra_pickle")
    expect(name(undefined, "opencode", "deepseek-v4-flash-free")).toBe("Sandra_seek")
    expect(name(undefined, "opencode", "another-model")).toBe("another-model")
  })
})
