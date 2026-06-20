import _sodium from "libsodium-wrappers-sumo"

// Fixed 16-byte salt: "src-keypair-v1  " — MUST match packages/shared/src/crypto.ts
const KEYPAIR_SALT = new Uint8Array([
  0x73, 0x72, 0x63, 0x2d, 0x6b, 0x65, 0x79, 0x70,
  0x61, 0x69, 0x72, 0x2d, 0x76, 0x31, 0x20, 0x20,
])

const ready = _sodium.ready

async function deriveSourceKeypair(
  diceware2: string
): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
  await _sodium.ready
  const seed = _sodium.crypto_pwhash(
    32,
    new TextEncoder().encode(diceware2),
    KEYPAIR_SALT,
    _sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    _sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    _sodium.crypto_pwhash_ALG_ARGON2ID13
  )
  return _sodium.crypto_box_seed_keypair(seed)
}

function sealedBoxEncrypt(plaintext: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  return _sodium.crypto_box_seal(plaintext, recipientPublicKey)
}

function boxOpen(
  ciphertextWithNonce: Uint8Array,
  senderPublicKey: Uint8Array,
  recipientPrivateKey: Uint8Array
): Uint8Array {
  const nonce = ciphertextWithNonce.subarray(0, _sodium.crypto_box_NONCEBYTES)
  const data = ciphertextWithNonce.subarray(_sodium.crypto_box_NONCEBYTES)
  const result = _sodium.crypto_box_open_easy(data, nonce, senderPublicKey, recipientPrivateKey)
  if (!result) throw new Error("Decryption failed — wrong key or corrupted data")
  return result
}

function fromHex(hex: string): Uint8Array { return _sodium.from_hex(hex) }
function toHex(bytes: Uint8Array): string { return _sodium.to_hex(bytes) }
function toBase64(bytes: Uint8Array): string {
  return _sodium.to_base64(bytes, _sodium.base64_variants.ORIGINAL)
}
function fromBase64(b64: string): Uint8Array {
  return _sodium.from_base64(b64, _sodium.base64_variants.ORIGINAL)
}

;(globalThis as any).PortalCrypto = {
  ready,
  deriveSourceKeypair,
  sealedBoxEncrypt,
  boxOpen,
  fromHex,
  toHex,
  toBase64,
  fromBase64,
}
