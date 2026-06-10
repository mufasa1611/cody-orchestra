import { describe, expect, test } from "bun:test"
import { extractUpdateProgress, isUpdateAvailable, DialogUpdateProgress } from "./dialog-update-progress"
import type { Component } from "solid-js"

describe("extractUpdateProgress", () => {
  test("extracts message from update.progress event", () => {
    const result = extractUpdateProgress({
      name: "",
      details: { type: "update.progress", properties: { message: "Fetching latest code..." } },
    })
    expect(result).toBe("Fetching latest code...")
  })

  test("returns null for non-progress events", () => {
    const result = extractUpdateProgress({
      name: "",
      details: { type: "installation.updated", properties: { version: "1.0.0" } },
    })
    expect(result).toBeNull()
  })

  test("returns null when message property is missing", () => {
    const result = extractUpdateProgress({
      name: "",
      details: { type: "update.progress", properties: {} },
    })
    expect(result).toBeNull()
  })

  test("updates message on subsequent progress events", () => {
    const first = extractUpdateProgress({
      name: "",
      details: { type: "update.progress", properties: { message: "Fetching..." } },
    })
    expect(first).toBe("Fetching...")

    const second = extractUpdateProgress({
      name: "",
      details: { type: "update.progress", properties: { message: "Building..." } },
    })
    expect(second).toBe("Building...")
  })
})

describe("isUpdateAvailable", () => {
  test("detects installation.update-available event", () => {
    const result = isUpdateAvailable({
      name: "",
      details: { type: "installation.update-available", properties: { version: "1.2.3" } },
    })
    expect(result).toEqual({ available: true, version: "1.2.3" })
  })

  test("uses latest as default version when not provided", () => {
    const result = isUpdateAvailable({
      name: "",
      details: { type: "installation.update-available", properties: {} },
    })
    expect(result).toEqual({ available: true, version: "latest" })
  })

  test("returns not available for unrelated events", () => {
    const result = isUpdateAvailable({
      name: "",
      details: { type: "server.connected", properties: {} },
    })
    expect(result).toEqual({ available: false })
  })
})

describe("DialogUpdateProgress", () => {
  test("exports as a valid SolidJS component", () => {
    expect(typeof DialogUpdateProgress).toBe("function")
  })
})
