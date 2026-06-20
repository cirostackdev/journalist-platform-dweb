import { writeFileSync, renameSync, readdirSync, readFileSync, unlinkSync } from "fs"
import { join } from "path"
import { randomUUID } from "crypto"
import { encryptData, decryptData } from "./crypto"

export async function writeQueueMessage(
  queueDir: string,
  queueKey: Uint8Array,
  payload: Record<string, unknown>
): Promise<void> {
  const json = JSON.stringify({ ...payload, _timestamp: Date.now() })
  const encrypted = await encryptData(json, queueKey)
  const filename = `${randomUUID()}.msg`
  const tmpPath = join(queueDir, `${filename}.tmp`)
  const finalPath = join(queueDir, filename)
  writeFileSync(tmpPath, encrypted, "utf8")
  renameSync(tmpPath, finalPath)
}

export async function readQueueMessages(
  queueDir: string,
  queueKey: Uint8Array
): Promise<Record<string, unknown>[]> {
  const files = readdirSync(queueDir).filter((f) => f.endsWith(".msg"))
  const results: Record<string, unknown>[] = []

  for (const file of files) {
    const filePath = join(queueDir, file)
    const encrypted = readFileSync(filePath, "utf8")
    const decrypted = await decryptData(encrypted, queueKey)
    results.push(JSON.parse(decrypted.toString("utf8")))
  }

  return results
}

export async function consumeQueueMessage(
  queueDir: string,
  queueKey: Uint8Array
): Promise<Record<string, unknown> | null> {
  const files = readdirSync(queueDir).filter((f) => f.endsWith(".msg"))
  if (files.length === 0) return null

  const filePath = join(queueDir, files[0])
  const encrypted = readFileSync(filePath, "utf8")
  const decrypted = await decryptData(encrypted, queueKey)
  unlinkSync(filePath)
  return JSON.parse(decrypted.toString("utf8"))
}
