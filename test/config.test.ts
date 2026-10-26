import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const base = {
  SWML_BASIC_AUTH_USER: 'user',
  SWML_BASIC_AUTH_PASSWORD: 'secret',
  ALLOWED_CALLERS: '+15551234567, +1 (555) 765-4321',
  CALLER_PIN: '482913',
};

describe('loadConfig', () => {
  it('parses a valid environment and applies defaults', () => {
    const config = loadConfig({ ...base });
    expect([...config.allowedCallers]).toEqual(['+15551234567', '+15557654321']);
    expect(config.pin).toBe('482913');
    expect(config.port).toBe(3000);
    expect(config.timezone).toBe('UTC');
    expect(config.voice).toBe('inworld.Mark');
    expect(config.gmailTokenPath).toBe('secrets/token.json');
  });

  it('accepts SIP addresses alongside numbers', () => {
    const config = loadConfig({ ...base, ALLOWED_CALLERS: '+15551234567, sip:Phone1@example.sip.signalwire.com' });
    expect([...config.allowedCallers]).toEqual(['+15551234567', 'phone1@example.sip.signalwire.com']);
  });

  it('reads optional values', () => {
    const config = loadConfig({ ...base, PORT: '8080', TIMEZONE: 'America/Los_Angeles', AGENT_VOICE: 'rachel' });
    expect(config.port).toBe(8080);
    expect(config.timezone).toBe('America/Los_Angeles');
    expect(config.voice).toBe('rachel');
  });

  it.each([
    [{ SWML_BASIC_AUTH_PASSWORD: '' }, /SWML_BASIC_AUTH_PASSWORD/],
    [{ ALLOWED_CALLERS: '' }, /ALLOWED_CALLERS/],
    [{ ALLOWED_CALLERS: ' , ' }, /no numbers/],
    [{ ALLOWED_CALLERS: '+15551234567,5551234567' }, /not E\.164/],
    [{ CALLER_PIN: '12' }, /4 to 8 digits/],
    [{ CALLER_PIN: '12ab' }, /4 to 8 digits/],
    [{ TIMEZONE: 'Mars/Olympus' }, /time zone/],
    [{ PORT: 'eighty' }, /port/],
  ])('rejects %j', (override, message) => {
    expect(() => loadConfig({ ...base, ...override })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, ...override })).toThrow(message);
  });
});
