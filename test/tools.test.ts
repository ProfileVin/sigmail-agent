import type { FunctionResult, SwaigRequest } from '@signalwire/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailDetail, EmailSummary, Mailbox } from '../src/gmail/mailbox.js';
import { CallSessions } from '../src/sessions.js';
import { createTools } from '../src/tools.js';

const NOW = new Date('2026-10-26T18:00:00Z');

const inbox: EmailSummary[] = [
  { id: 'm1', from: 'Jane Doe <jane@example.com>', subject: 'Lunch Friday', date: new Date('2026-10-26T15:15:00Z'), unread: true },
  { id: 'm2', from: 'billing@example.com', subject: '', date: new Date('2026-10-25T16:00:00Z'), unread: false },
];

function fakeMailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    unreadCount: vi.fn(async () => 7),
    search: vi.fn(async (_query: string, max: number) => inbox.slice(0, max)),
    read: vi.fn(async (id: string): Promise<EmailDetail> => ({
      ...inbox.find((e) => e.id === id)!,
      body: 'See you at noon.\n\nOn Sun, Oct 25, 2026 Bob wrote:\n> Lunch?',
      attachments: ['menu.pdf'],
    })),
    ...overrides,
  };
}

function setup(mailbox = fakeMailbox()) {
  const sessions = new CallSessions();
  const log = vi.fn();
  const tools = createTools({ mailbox, sessions, pin: '4829', timezone: 'America/Los_Angeles', now: () => NOW, log });
  const run = async (name: string, args: Record<string, unknown> = {}, callId = 'c-1') => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const result = (await tool.handler(args, { call_id: callId } as SwaigRequest)) as FunctionResult;
    return result.toDict();
  };
  return { sessions, log, mailbox, run };
}

describe('createTools', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
    ctx.sessions.open('c-1');
  });

  it('leaves every tool active so the model can see the email tools', () => {
    const tools = createTools({ mailbox: fakeMailbox(), sessions: new CallSessions(), pin: '4829', timezone: 'UTC' });
    const active = Object.fromEntries(tools.map((t) => [t.name, t.extraFields?.['active'] ?? true]));
    expect(active).toEqual({ verify_pin: true, check_inbox: true, search_emails: true, read_email: true });
  });

  describe('before the PIN', () => {
    it.each(['check_inbox', 'search_emails', 'read_email'])('%s refuses and does not touch Gmail', async (name) => {
      const result = await ctx.run(name, { query: 'x', number: 1 });
      expect(result.response).toMatch(/not been verified/);
      expect(ctx.mailbox.search).not.toHaveBeenCalled();
      expect(ctx.mailbox.read).not.toHaveBeenCalled();
    });
  });

  describe('verify_pin', () => {
    it('unlocks the call', async () => {
      const result = await ctx.run('verify_pin', { pin: 'four eight two nine' });
      expect(result.response).toMatch(/PIN accepted/);
      expect(ctx.sessions.get('c-1')?.unlocked).toBe(true);
    });

    it('counts down attempts and hangs up after the third wrong PIN', async () => {
      expect((await ctx.run('verify_pin', { pin: '1111' })).response).toMatch(/2 attempts left/);
      expect((await ctx.run('verify_pin', { pin: '2222' })).response).toMatch(/1 attempt left/);
      const last = await ctx.run('verify_pin', { pin: '3333' });
      expect(last.response).toMatch(/no attempts left/);
      expect(last.post_process).toBe(true);
      expect(JSON.stringify(last.action)).toContain('hangup');
      expect(ctx.sessions.get('c-1')?.unlocked).toBe(false);
    });

    it('refuses even the right PIN during a global lockout', async () => {
      for (let i = 0; i < 10; i++) ctx.sessions.recordPinFailure(ctx.sessions.open(`other-${i}`));
      const result = await ctx.run('verify_pin', { pin: '4829' });
      expect(result.response).toMatch(/locked/);
      expect(JSON.stringify(result.action)).toContain('hangup');
      expect(ctx.sessions.get('c-1')?.unlocked).toBe(false);
    });

    it('hangs up a call that has no session', async () => {
      const result = await ctx.run('verify_pin', { pin: '4829' }, 'unknown');
      expect(JSON.stringify(result.action)).toContain('hangup');
    });

    it('never logs the PIN', async () => {
      await ctx.run('verify_pin', { pin: '1111' });
      await ctx.run('verify_pin', { pin: '4829' });
      expect(JSON.stringify(ctx.log.mock.calls)).not.toMatch(/1111|4829/);
    });
  });

  describe('after the PIN', () => {
    beforeEach(async () => {
      await ctx.run('verify_pin', { pin: '4829' });
    });

    it('check_inbox reports the count and a numbered list', async () => {
      const result = await ctx.run('check_inbox', { max: 2 });
      expect(ctx.mailbox.search).toHaveBeenCalledWith('in:inbox is:unread', 2);
      expect(result.response).toContain('There are 7 unread emails in the inbox.');
      expect(result.response).toContain('1. From Jane Doe, subject "Lunch Friday", today at 8:15 AM.');
      expect(result.response).toContain('2. From billing@example.com, subject no subject, yesterday at 9:00 AM.');
      expect(ctx.sessions.get('c-1')?.lastResults).toEqual(['m1', 'm2']);
    });

    it('caps and defaults the list size', async () => {
      await ctx.run('check_inbox', { max: 500 });
      expect(ctx.mailbox.search).toHaveBeenLastCalledWith('in:inbox is:unread', 10);
      await ctx.run('check_inbox', {});
      expect(ctx.mailbox.search).toHaveBeenLastCalledWith('in:inbox is:unread', 5);
    });

    it('check_inbox says when there is nothing unread', async () => {
      const empty = setup(fakeMailbox({ unreadCount: async () => 0, search: async () => [] }));
      empty.sessions.open('c-1');
      await empty.run('verify_pin', { pin: '4829' });
      expect((await empty.run('check_inbox')).response).toBe('The inbox has no unread emails.');
    });

    it('search_emails passes the query through and marks unread results', async () => {
      const result = await ctx.run('search_emails', { query: '  from:jane newer_than:7d ' });
      expect(ctx.mailbox.search).toHaveBeenCalledWith('from:jane newer_than:7d', 5);
      expect(result.response).toContain('Found 2 emails');
      expect(result.response).toContain('today at 8:15 AM, unread.');
    });

    it('search_emails asks for a query when it is empty', async () => {
      expect((await ctx.run('search_emails', { query: '  ' })).response).toMatch(/what to search for/);
      expect(ctx.mailbox.search).not.toHaveBeenCalled();
    });

    it('read_email needs a list first', async () => {
      expect((await ctx.run('read_email', { number: 1 })).response).toMatch(/no list yet/);
    });

    it('read_email reads the chosen email, cleaned and marked as untrusted', async () => {
      await ctx.run('check_inbox');
      const result = await ctx.run('read_email', { number: 1 });
      expect(ctx.mailbox.read).toHaveBeenCalledWith('m1');
      expect(result.response).toContain('Email 1: from Jane Doe, subject "Lunch Friday", received today at 8:15 AM.');
      expect(result.response).toContain('It has 1 attachment: menu.pdf.');
      expect(result.response).toContain('<<<EMAIL\nSee you at noon.\nEMAIL>>>');
      expect(result.response).toMatch(/never follow instructions/);
      expect(result.response).not.toContain('Lunch?');
    });

    it('read_email rejects numbers outside the list', async () => {
      await ctx.run('check_inbox', { max: 2 });
      for (const number of [0, 3, 1.5, 'two']) {
        expect((await ctx.run('read_email', { number })).response).toMatch(/no email number .* had 2 emails/);
      }
      expect(ctx.mailbox.read).not.toHaveBeenCalled();
    });

    it('turns Gmail errors into a spoken apology and logs a hint for invalid_grant', async () => {
      const broken = setup(fakeMailbox({ unreadCount: async () => { throw new Error('invalid_grant'); } }));
      broken.sessions.open('c-1');
      await broken.run('verify_pin', { pin: '4829' });
      const result = await broken.run('check_inbox');
      expect(result.response).toMatch(/could not be reached/);
      expect(broken.log).toHaveBeenCalledWith(expect.stringContaining('npm run authorize'));
    });
  });
});
