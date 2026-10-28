import type { AgentBase } from '@signalwire/sdk';
import { buildAgent } from './agent.js';
import { loadConfig } from './config.js';
import { createGmailClient, loadAuthorizedClient } from './gmail/auth.js';
import { GmailMailbox } from './gmail/mailbox.js';
import { CallSessions } from './sessions.js';

const log = (message: string): void => console.log(`[sigmail] ${message}`);

function fail(err: unknown): never {
  console.error(`[sigmail] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

async function start(): Promise<AgentBase> {
  const config = loadConfig();
  const auth = await loadAuthorizedClient(config.gmailCredentialsPath, config.gmailTokenPath);
  const mailbox = new GmailMailbox(createGmailClient(auth));
  const agent = buildAgent({
    mailbox,
    sessions: new CallSessions(),
    allowedCallers: config.allowedCallers,
    pin: config.pin,
    timezone: config.timezone,
    voice: config.voice,
    log,
  });

  // swaig-test imports this file to inspect the agent; only a real run talks to Gmail and listens.
  if (process.env['SWAIG_CLI_MODE'] !== 'true') {
    try {
      const unread = await mailbox.unreadCount();
      log(`Gmail connected: ${unread} unread in Primary`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Gmail check failed: ${message}. If the token expired or was revoked, run "npm run authorize".`);
    }
    if (!process.env['SWML_PROXY_URL_BASE']) {
      log('SWML_PROXY_URL_BASE is not set; tool webhook URLs will use the request host.');
    }
    log(`Allowlisted callers: ${config.allowedCallers.size}`);
    await agent.run({ port: config.port });
  }
  return agent;
}

export const agent = await start().catch(fail);
