import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Ephemeral in-memory fallback for signing session tokens when SESSION_SECRET isn't set
const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

function getSigningSecret(): string {
  return process.env.SESSION_SECRET || EPHEMERAL_SECRET;
}

export function generateBase32Secret(bytes = 20): string {
  const buf = crypto.randomBytes(bytes);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function decodeBase32(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpCode(secretBase32: string, stepOffset = 0): string {
  const key = decodeBase32(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / 30) + stepOffset;
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const code = binary % 1_000_000;
  return code.toString().padStart(6, '0');
}

export function verifyTotpCode(secretBase32: string, codeInput: string): boolean {
  const normalized = String(codeInput || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  for (const offset of [-1, 0, 1]) {
    const expected = generateTotpCode(secretBase32, offset);
    if (
      expected.length === normalized.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))
    ) {
      return true;
    }
  }
  return false;
}

export function buildTotpUri(accountEmail: string, secretBase32: string, roleLabel: string): string {
  const issuer = encodeURIComponent('Dnyanshree Library');
  const label = encodeURIComponent(`Dnyanshree Library:${accountEmail} (${roleLabel})`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hexHash] = storedHash.split(':');
  if (!salt || !hexHash) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hexHash, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export interface SessionPayload {
  sub: string;
  role: 'student' | 'teacher' | 'admin';
  email: string;
  mfaVerified: boolean;
  exp: number;
}

export function signToken(payload: Omit<SessionPayload, 'exp'>, ttlSeconds = 8 * 3600): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyToken(token: string): SessionPayload | null {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;
  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function signQrPayload(prn: string): string {
  const normalized = prn.trim().toUpperCase();
  const sig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(`DIET-SATARA-LIB:${normalized}`)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
  return `DIET-LIB:${normalized}:${sig}`;
}

export function signTeacherQrPayload(employeeId: string): string {
  const normalized = employeeId.trim().toUpperCase();
  const sig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(`DIET-SATARA-TCH:${normalized}`)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
  return `DIET-TCH:${normalized}:${sig}`;
}

export function parseAndVerifyQrPayload(raw: string): {
  valid: boolean;
  prn: string | null;
  memberType: 'student' | 'teacher' | null;
  isGateQr: boolean;
} {
  const trimmed = String(raw || '').trim();
  if (trimmed === 'DIET-GATE:CENTRAL-LIBRARY-SATARA') {
    return { valid: true, prn: null, memberType: null, isGateQr: true };
  }
  if (trimmed.startsWith('DIET-LIB:')) {
    const parts = trimmed.split(':');
    if (parts.length === 3) {
      const prn = parts[1].toUpperCase();
      return { valid: /^[A-Z0-9-]+$/.test(prn), prn, memberType: 'student', isGateQr: false };
    }
  }
  if (trimmed.startsWith('DIET-TCH:')) {
    const parts = trimmed.split(':');
    if (parts.length === 3) {
      const empId = parts[1].toUpperCase();
      return { valid: /^[A-Z0-9-]+$/.test(empId), prn: empId, memberType: 'teacher', isGateQr: false };
    }
  }
  const upper = trimmed.toUpperCase();
  if (/^(TCH|FAC)[A-Z0-9-]{2,28}$/.test(upper)) {
    return { valid: true, prn: upper, memberType: 'teacher', isGateQr: false };
  }
  if (/^(DIET|DEG|DIP)[A-Z0-9-]{3,28}$/.test(upper)) {
    return { valid: true, prn: upper, memberType: 'student', isGateQr: false };
  }
  return { valid: false, prn: null, memberType: null, isGateQr: false };
}
