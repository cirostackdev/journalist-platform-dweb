import { describe, test, expect } from "bun:test"
import { generateDiceware } from "../src/wordlist"

describe("generateDiceware", () => {
  test("returns a 7-word hyphenated phrase", async () => {
    const diceware = await generateDiceware()
    const parts = diceware.split("-")
    expect(parts).toHaveLength(7)
    parts.forEach((p) => expect(p.length).toBeGreaterThan(0))
  })

  test("generates different phrases across calls", async () => {
    const phrases = new Set<string>()
    for (let i = 0; i < 10; i++) {
      phrases.add(await generateDiceware())
    }
    expect(phrases.size).toBeGreaterThan(1)
  })

  test("uses only lowercase alphabetic words", async () => {
    const diceware = await generateDiceware()
    expect(diceware).toMatch(/^[a-z]+(-[a-z]+){6}$/)
  })
})
