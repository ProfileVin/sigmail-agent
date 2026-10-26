import { normalizeCaller } from './security.js';

export interface Config {
  port: number;
  allowedCallers: ReadonlySet<string>;
  pin: string;
  timezone: string;
  voice: string;
  gmailCredentialsPath: string;
  gmailTokenPath: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new ConfigError(`${key} is not set (see .env.example)`);
  return value;
}

/** Reads and validates the environment; throws ConfigError on the first problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // The SDK reads these itself, but without fixed values it generates a new
  // password on every restart and the dashboard URL stops working.
  required(env, 'SWML_BASIC_AUTH_USER');
  required(env, 'SWML_BASIC_AUTH_PASSWORD');

  const allowedCallers = new Set<string>();
  for (const entry of required(env, 'ALLOWED_CALLERS').split(',')) {
    if (!entry.trim()) continue;
    const normalized = normalizeCaller(entry);
    if (!normalized) {
      throw new ConfigError(
        `ALLOWED_CALLERS entry "${entry.trim()}" is not E.164 (e.g. +15551234567) or a SIP address (e.g. phone1@example.sip.signalwire.com)`,
      );
    }
    allowedCallers.add(normalized);
  }
  if (allowedCallers.size === 0) throw new ConfigError('ALLOWED_CALLERS has no numbers');

  const pin = required(env, 'CALLER_PIN');
  if (!/^\d{4,8}$/.test(pin)) throw new ConfigError('CALLER_PIN must be 4 to 8 digits');

  const timezone = env['TIMEZONE']?.trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new ConfigError(`TIMEZONE "${timezone}" is not a valid IANA time zone`);
  }

  const port = Number(env['PORT'] ?? 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ConfigError(`PORT "${env['PORT']}" is not a valid port`);
  }

  return {
    port,
    allowedCallers,
    pin,
    timezone,
    voice: env['AGENT_VOICE']?.trim() || 'inworld.Mark',
    gmailCredentialsPath: env['GMAIL_CREDENTIALS_PATH']?.trim() || 'secrets/credentials.json',
    gmailTokenPath: env['GMAIL_TOKEN_PATH']?.trim() || 'secrets/token.json',
  };
}
