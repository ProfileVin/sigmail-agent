import { readFile } from 'node:fs/promises';
import { gmail, type gmail_v1 } from '@googleapis/gmail';
import { OAuth2Client } from 'google-auth-library';

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

export interface OAuthClientInfo {
  client_id: string;
  client_secret: string;
}

/** Shape written by `npm run authorize`; also what google-auth-library's `fromJSON` accepts. */
export interface StoredToken extends OAuthClientInfo {
  type: 'authorized_user';
  refresh_token: string;
}

async function readJson(path: string, hint: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new Error(`Cannot read ${path}. ${hint}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} is not valid JSON. ${hint}`);
  }
}

/** Reads the "Desktop app" OAuth client JSON downloaded from Google Cloud Console. */
export async function readClientInfo(path: string): Promise<OAuthClientInfo> {
  const parsed = (await readJson(path, 'Download the Desktop app OAuth client JSON there (see README).')) as {
    installed?: Partial<OAuthClientInfo>;
    web?: Partial<OAuthClientInfo>;
  };
  const info = parsed.installed ?? parsed.web;
  if (!info?.client_id || !info.client_secret) {
    throw new Error(`${path} is not an OAuth client file (expected an "installed" Desktop app client).`);
  }
  return { client_id: info.client_id, client_secret: info.client_secret };
}

/** An OAuth client holding the stored refresh token; access tokens refresh automatically. */
export async function loadAuthorizedClient(credentialsPath: string, tokenPath: string): Promise<OAuth2Client> {
  const info = await readClientInfo(credentialsPath);
  const token = (await readJson(tokenPath, 'Run "npm run authorize" first.')) as Partial<StoredToken>;
  if (!token.refresh_token) {
    throw new Error(`${tokenPath} has no refresh_token. Run "npm run authorize" again.`);
  }
  const client = new OAuth2Client({ clientId: info.client_id, clientSecret: info.client_secret });
  client.setCredentials({ refresh_token: token.refresh_token });
  return client;
}

export function createGmailClient(auth: OAuth2Client): gmail_v1.Gmail {
  return gmail({ version: 'v1', auth });
}
