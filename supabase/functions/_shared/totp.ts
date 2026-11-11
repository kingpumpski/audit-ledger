// Minimal TOTP (RFC 6238) verifier + base32 helpers, no external deps.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '')
  let bits = 0, value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = B32.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(out)
}

export function generateTotpSecret(length = 20): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return base32Encode(bytes)
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const buf = new ArrayBuffer(8)
  const view = new DataView(buf)
  view.setUint32(0, Math.floor(counter / 0x100000000))
  view.setUint32(4, counter % 0x100000000)
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf))
  const offset = sig[sig.length - 1] & 0x0f
  const code =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff)
  return String(code % 1_000_000).padStart(6, '0')
}

export async function verifyTotp(secretB32: string, code: string, window = 1): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false
  const secret = base32Decode(secretB32)
  const step = Math.floor(Date.now() / 30_000)
  for (let i = -window; i <= window; i++) {
    if (await hotp(secret, step + i) === code) return true
  }
  return false
}
