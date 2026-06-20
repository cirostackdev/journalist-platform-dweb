#!/usr/bin/env bun
/**
 * One-time setup script: generate the newsroom X25519 keypair.
 *
 * Run ONCE, then store the output in your environment files:
 *   NEWSROOM_PUBLIC_KEY_HEX  → source portal + workspace env
 *   NEWSROOM_PRIVATE_KEY_HEX → workspace env ONLY (never commit, never share)
 *
 * Usage: bun scripts/generate-keypair.ts
 */
import { generateNewsroomKeypair } from "./packages/shared/src/crypto"

const { publicKey, privateKey } = await generateNewsroomKeypair()
const pubHex = Buffer.from(publicKey).toString("hex")
const privHex = Buffer.from(privateKey).toString("hex")

console.error("⚠️  SECURITY: The NEWSROOM_PRIVATE_KEY_HEX below must never be committed,")
console.error("    logged, or shared. Store it in a secrets manager or secure .env file.")
console.error("    Delete it from your terminal history after use.")
console.error("")
console.log("# Source portal environment (public key only):")
console.log(`NEWSROOM_PUBLIC_KEY_HEX=${pubHex}`)
console.log("")
console.log("# Workspace environment (KEEP PRIVATE — do NOT put in source portal):")
console.log(`NEWSROOM_PUBLIC_KEY_HEX=${pubHex}`)
console.log(`NEWSROOM_PRIVATE_KEY_HEX=${privHex}`)
