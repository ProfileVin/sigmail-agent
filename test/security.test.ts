import { describe, expect, it } from 'vitest';
import { digitsFromSpeech, isAllowedCaller, normalizeCaller, normalizeE164, pinMatches } from '../src/security.js';

describe('normalizeE164', () => {
  it.each([
    ['+15551234567', '+15551234567'],
    ['+1 (555) 123-4567', '+15551234567'],
    ['+44 20 7946 0958', '+442079460958'],
    ['sip:+15551234567@example.sip.signalwire.com', '+15551234567'],
    ['tel:+15551234567', '+15551234567'],
  ])('normalizes %s', (raw, expected) => {
    expect(normalizeE164(raw)).toBe(expected);
  });

  it.each(['5551234567', '15551234567', '+1234', '', 'anonymous', '+1555123456789012'])('rejects %j', (raw) => {
    expect(normalizeE164(raw)).toBeNull();
  });

  it('rejects missing values', () => {
    expect(normalizeE164(undefined)).toBeNull();
    expect(normalizeE164(null)).toBeNull();
  });
});

describe('normalizeCaller', () => {
  it.each([
    ['+1 (555) 123-4567', '+15551234567'],
    ['sip:+15551234567@example.sip.signalwire.com', '+15551234567'],
    ['phone1@example.sip.signalwire.com', 'phone1@example.sip.signalwire.com'],
    ['sip:Phone1@Example.SIP.SignalWire.com', 'phone1@example.sip.signalwire.com'],
    ['sips:phone1@example.sip.signalwire.com;transport=tls', 'phone1@example.sip.signalwire.com'],
  ])('normalizes %s', (raw, expected) => {
    expect(normalizeCaller(raw)).toBe(expected);
  });

  it.each(['5551234567', 'anonymous', 'phone1', 'phone1@', '@example.com', 'phone1@localhost', 'a b@example.com'])(
    'rejects %j',
    (raw) => {
      expect(normalizeCaller(raw)).toBeNull();
    },
  );
});

describe('isAllowedCaller', () => {
  const allowed = new Set(['+15551234567', 'phone1@example.sip.signalwire.com']);

  it('accepts a listed number in any formatting', () => {
    expect(isAllowedCaller('+1 555 123 4567', allowed)).toBe(true);
  });

  it('accepts a listed SIP address as a URI', () => {
    expect(isAllowedCaller('sip:phone1@example.sip.signalwire.com', allowed)).toBe(true);
  });

  it('rejects unlisted, malformed and missing numbers', () => {
    expect(isAllowedCaller('+15557654321', allowed)).toBe(false);
    expect(isAllowedCaller('5551234567', allowed)).toBe(false);
    expect(isAllowedCaller(undefined, allowed)).toBe(false);
  });

  it('rejects the same SIP user on another domain', () => {
    expect(isAllowedCaller('sip:phone1@attacker.example.com', allowed)).toBe(false);
  });
});

describe('digitsFromSpeech', () => {
  it.each([
    ['4829', '4829'],
    ['4 8 2 9', '4829'],
    ['4-8-2-9', '4829'],
    ['four eight two nine', '4829'],
    ['Four, eight, 2, nine.', '4829'],
    ['oh one zero', '010'],
    ['the pin for it is 4829', '4829'],
    ['my pin is', ''],
  ])('%j -> %j', (spoken, digits) => {
    expect(digitsFromSpeech(spoken)).toBe(digits);
  });
});

describe('pinMatches', () => {
  it('matches the same digits however they were spoken', () => {
    expect(pinMatches('4829', '4829')).toBe(true);
    expect(pinMatches('four eight two nine', '4829')).toBe(true);
  });

  it('rejects wrong, shorter, longer and empty PINs', () => {
    expect(pinMatches('4828', '4829')).toBe(false);
    expect(pinMatches('482', '4829')).toBe(false);
    expect(pinMatches('48290', '4829')).toBe(false);
    expect(pinMatches('', '4829')).toBe(false);
  });
});
