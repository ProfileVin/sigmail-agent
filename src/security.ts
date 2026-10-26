import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Normalizes a phone number to E.164 (`+` followed by 8-15 digits).
 * Accepts formatting characters and a `sip:`/`tel:` URI wrapper; returns null
 * for anything without a leading `+` country code rather than guessing one.
 */
export function normalizeE164(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let value = raw.trim().replace(/^(sip|sips|tel):/i, '');
  const at = value.indexOf('@');
  if (at >= 0) value = value.slice(0, at);
  value = value.replace(/[\s().-]/g, '');
  return /^\+\d{8,15}$/.test(value) ? value : null;
}

/**
 * Normalizes a caller ID for the allowlist: an E.164 number when there is one
 * (so `sip:+15551234567@host` still matches `+15551234567`), otherwise a SIP
 * address as lowercase `user@host` with URI parameters and headers dropped.
 */
export function normalizeCaller(raw: string | undefined | null): string | null {
  const e164 = normalizeE164(raw);
  if (e164) return e164;
  if (!raw) return null;
  const value = raw
    .trim()
    .replace(/^(sips?):/i, '')
    .split(/[;?]/)[0]!
    .toLowerCase();
  return /^[^@\s]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value) ? value : null;
}

export function isAllowedCaller(from: string | undefined, allowed: ReadonlySet<string>): boolean {
  const normalized = normalizeCaller(from);
  return normalized !== null && allowed.has(normalized);
}

// Homophones like "to" and "for" are left out on purpose: "the PIN for it is
// 4829" must not turn into "44829".
const SPOKEN_DIGITS: Record<string, string> = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};

/**
 * Turns what the caller said into a digit string. Speech recognition may hand
 * the model "4 8 2 9", "4-8-2-9" or "four eight two nine"; all become "4829".
 */
export function digitsFromSpeech(spoken: string): string {
  return spoken
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => (/^\d+$/.test(token) ? token : (SPOKEN_DIGITS[token] ?? '')))
    .join('');
}

/** Constant-time PIN comparison (hashing first makes the lengths equal). */
export function pinMatches(spoken: string, expected: string): boolean {
  const a = createHash('sha256').update(digitsFromSpeech(spoken)).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
