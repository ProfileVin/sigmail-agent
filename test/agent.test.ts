import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { REJECTION_MESSAGE, buildAgent } from '../src/agent.js';
import type { Mailbox } from '../src/gmail/mailbox.js';
import { CallSessions } from '../src/sessions.js';

const ALLOWED = '+15551234567';
const auth = { authorization: `Basic ${Buffer.from('test-user:test-pass').toString('base64')}`, 'content-type': 'application/json' };

interface SwmlFunction {
  function: string;
  web_hook_url: string;
  active?: boolean;
}

beforeAll(() => {
  vi.stubEnv('SWML_BASIC_AUTH_USER', 'test-user');
  vi.stubEnv('SWML_BASIC_AUTH_PASSWORD', 'test-pass');
  vi.stubEnv('SWML_PROXY_URL_BASE', '');
  vi.stubEnv('SIGNALWIRE_SIGNING_KEY', '');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

function setup() {
  const mailbox: Mailbox = {
    unreadCount: vi.fn(async () => 1),
    search: vi.fn(async () => ({ emails: [{ id: 'm1', from: 'Jane <j@example.com>', subject: 'Hi', date: null, unread: true }] })),
    read: vi.fn(async () => {
      throw new Error('not used');
    }),
  };
  const sessions = new CallSessions();
  const agent = buildAgent({
    mailbox,
    sessions,
    allowedCallers: new Set([ALLOWED]),
    pin: '4829',
    timezone: 'UTC',
    voice: 'inworld.Mark',
    log: () => {},
  });
  const app = agent.getApp();

  const post = async (path: string, body: unknown, headers: Record<string, string> = auth) => {
    const res = await app.request(path, { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: res.status, text: await res.text() };
  };

  const startCall = async (callId: string, from: string) => {
    const { status, text } = await post('/', { call: { call_id: callId, from, to: '+15550000000', project_id: 'p', space_id: 's' } });
    expect(status).toBe(200);
    const main = (JSON.parse(text) as { sections: { main: Record<string, unknown>[] } }).sections.main;
    const ai = main.find((verb) => 'ai' in verb)?.['ai'] as { SWAIG?: { functions?: SwmlFunction[] } } | undefined;
    return { verbs: main.map((verb) => Object.keys(verb)[0]), functions: ai?.SWAIG?.functions ?? [] };
  };

  const callTool = async (fn: SwmlFunction | undefined, callId: string, args: Record<string, unknown> = {}) => {
    const url = new URL(fn?.web_hook_url ?? 'http://localhost/swaig');
    const name = fn?.function ?? 'check_inbox';
    return post(url.pathname + url.search, { function: name, call_id: callId, argument: { parsed: [args], raw: JSON.stringify(args) } });
  };

  return { mailbox, sessions, post, startCall, callTool };
}

describe('buildAgent', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('requires basic auth', async () => {
    const { status } = await ctx.post('/', { call: { call_id: 'c-1', from: ALLOWED } }, { 'content-type': 'application/json' });
    expect(status).toBe(401);
  });

  it('turns away a caller who is not on the allowlist', async () => {
    const { verbs, functions } = await ctx.startCall('c-x', '+15559990000');
    expect(verbs.slice(0, 3)).toEqual(['answer', 'play', 'hangup']);
    expect(functions.map((f) => f.function)).not.toContain('verify_pin');
    expect(ctx.sessions.get('c-x')).toBeUndefined();
  });

  it('gives an allowlisted caller the AI with all its tools active', async () => {
    const { verbs, functions } = await ctx.startCall('c-1', ALLOWED);
    expect(verbs).toEqual(['answer', 'ai']);
    const active = Object.fromEntries(functions.map((f) => [f.function, f.active ?? true]));
    expect(active).toMatchObject({ verify_pin: true, check_inbox: true, search_emails: true, more_emails: true, read_email: true });
    expect(JSON.stringify(functions)).not.toContain(REJECTION_MESSAGE);
  });

  it('runs the PIN gate end to end and clears the session at hangup', async () => {
    const { functions } = await ctx.startCall('c-1', ALLOWED);
    const fn = (name: string) => functions.find((f) => f.function === name);

    const early = await ctx.callTool(fn('check_inbox'), 'c-1');
    expect(early.text).toMatch(/not been verified/);
    expect(ctx.mailbox.search).not.toHaveBeenCalled();

    const pin = await ctx.callTool(fn('verify_pin'), 'c-1', { pin: '4829' });
    expect(pin.text).toMatch(/PIN accepted/);

    const inbox = await ctx.callTool(fn('check_inbox'), 'c-1');
    expect(inbox.text).toMatch(/1\. From Jane/);

    await ctx.callTool(fn('hangup_hook'), 'c-1');
    expect(ctx.sessions.get('c-1')).toBeUndefined();
  });

  it('gives a tool request from a call it never accepted nothing to run', async () => {
    const { functions } = await ctx.startCall('c-1', ALLOWED);
    const verify = functions.find((f) => f.function === 'verify_pin');
    const replay = await ctx.callTool(verify, 'c-other', { pin: '4829' });
    expect(replay.status).toBe(404);
    expect(ctx.sessions.get('c-other')).toBeUndefined();
  });

  it('rejects a tool request without its token', async () => {
    await ctx.startCall('c-1', ALLOWED);
    const res = await ctx.callTool(undefined, 'c-1');
    expect(res.text).toMatch(/token/i);
    expect(ctx.mailbox.search).not.toHaveBeenCalled();
  });
});
