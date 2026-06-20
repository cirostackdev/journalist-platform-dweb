import { describe, test, expect } from "bun:test"
import { generateCodename } from "../src/wordlist"

describe("generateCodename", () => {
  test("returns a three-word hyphenated phrase", async () => {
    const codename = await generateCodename()
    const parts = codename.split("-")
    expect(parts).toHaveLength(3)
    parts.forEach((p) => expect(p.length).toBeGreaterThan(0))
  })

  test("generates different codenames across calls", async () => {
    const codenames = new Set<string>()
    for (let i = 0; i < 10; i++) {
      codenames.add(await generateCodename())
    }
    expect(codenames.size).toBeGreaterThan(1)
  })

  test("uses only lowercase alphabetic words", async () => {
    const codename = await generateCodename()
    expect(codename).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/)
  })
})
