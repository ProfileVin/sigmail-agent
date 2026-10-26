/**
 * One-time Gmail sign-in. Opens Google's consent page, receives the redirect
 * on a loopback port, and saves the refresh token the server uses.
 *
 *   npm run authorize
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname } from 'node:path';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { GMAIL_SCOPES, createGmailClient, readClientInfo, type StoredToken } from '../src/gmail/auth.js';

const CALLBACK_PATH = '/oauth2callback';
const TIMEOUT_MS = 5 * 60 * 1000;

const credentialsPath = process.env['GMAIL_CREDENTIALS_PATH']?.trim() || 'secrets/credentials.json';
const tokenPath = process.env['GMAIL_TOKEN_PATH']?.trim() || 'secrets/token.json';

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    // The URL is printed too; opening it by hand works the same.
  }
}

/** Listens on a loopback port for one redirect; `code` settles with the authorization code. */
async function listenForRedirect(state: string): Promise<{ redirectUri: string; code: Promise<string> }> {
  let resolveCode!: (code: string) => void;
  let rejectCode!: (err: Error) => void;
  const code = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get('error');
    const received = url.searchParams.get('code');
    const ok = !error && received && url.searchParams.get('state') === state;
    res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(ok ? 'Sigmail is authorized. You can close this tab.' : 'Authorization failed. Check the terminal.');
    if (ok) resolveCode(received);
    else rejectCode(new Error(error ? `Google returned "${error}"` : 'The redirect had a missing code or a mismatched state'));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const timer = setTimeout(() => rejectCode(new Error('Timed out waiting for the browser sign-in')), TIMEOUT_MS);
  code
    .finally(() => {
      clearTimeout(timer);
      server.close();
    })
    .catch(() => {});

  return { redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`, code };
}

async function main(): Promise<void> {
  const info = await readClientInfo(credentialsPath);
  const state = randomBytes(16).toString('hex');
  const { redirectUri, code } = await listenForRedirect(state);

  const client = new OAuth2Client({ clientId: info.client_id, clientSecret: info.client_secret, redirectUri });
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const authUrl = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // always returns a refresh token, even on a repeat sign-in
    scope: GMAIL_SCOPES,
    state,
    code_challenge_method: CodeChallengeMethod.S256,
    code_challenge: codeChallenge!,
  });

  console.log('Opening Google sign-in in your browser. If it does not open, visit:\n');
  console.log(`  ${authUrl}\n`);
  openBrowser(authUrl);

  const { tokens } = await client.getToken({ code: await code, codeVerifier, redirect_uri: redirectUri });
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh token. Remove the app at https://myaccount.google.com/permissions and run this again.');
  }
  const granted = (tokens.scope ?? '').split(' ');
  if (!GMAIL_SCOPES.every((scope) => granted.includes(scope))) {
    throw new Error('Gmail read access was not granted. Run this again and leave the Gmail checkbox ticked.');
  }

  const stored: StoredToken = {
    type: 'authorized_user',
    client_id: info.client_id,
    client_secret: info.client_secret,
    refresh_token: tokens.refresh_token,
  };
  await mkdir(dirname(tokenPath), { recursive: true });
  await writeFile(tokenPath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });

  client.setCredentials(tokens);
  const gmail = createGmailClient(client);
  const [{ data: profile }, { data: inbox }] = await Promise.all([
    gmail.users.getProfile({ userId: 'me' }),
    gmail.users.labels.get({ userId: 'me', id: 'INBOX' }),
  ]);
  console.log(`Saved ${tokenPath}`);
  console.log(`Connected to ${profile.emailAddress}: ${inbox.messagesUnread ?? 0} unread in the inbox.`);
}

main().catch((err: unknown) => {
  console.error(`Authorization failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
