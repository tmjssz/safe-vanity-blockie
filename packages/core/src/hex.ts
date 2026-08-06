const HEX_BYTES = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

/** Lowercase 0x-prefixed hex for `bytes[start..end)`. */
export function bytesToHex(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let out = '0x'
  for (let i = start; i < end; i++) out += HEX_BYTES[bytes[i]]
  return out
}

export function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
  if (body.length % 2 !== 0) {
    throw new Error(`hexToBytes: odd-length hex string (${body.length} characters)`)
  }
  const out = new Uint8Array(body.length / 2)
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error(`hexToBytes: invalid hex at byte ${i}`)
    out[i] = byte
  }
  return out
}
