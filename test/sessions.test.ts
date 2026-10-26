import { describe, expect, it } from 'vitest';
import { CallSessions } from '../src/sessions.js';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('CallSessions', () => {
  it('opens a session once per call id', () => {
    const sessions = new CallSessions();
    const first = sessions.open('c-1');
    first.unlocked = true;
    expect(sessions.open('c-1')).toBe(first);
    expect(sessions.get('c-1')?.unlocked).toBe(true);
    expect(sessions.get('c-2')).toBeUndefined();
    expect(sessions.get(undefined)).toBeUndefined();
  });

  it('closes sessions', () => {
    const sessions = new CallSessions();
    sessions.open('c-1');
    sessions.close('c-1');
    expect(sessions.get('c-1')).toBeUndefined();
  });

  it('locks a call after the maximum number of wrong PINs', () => {
    const sessions = new CallSessions({ maxPinAttempts: 3 });
    const session = sessions.open('c-1');
    expect(sessions.recordPinFailure(session)).toBe('retry');
    expect(sessions.recordPinFailure(session)).toBe('retry');
    expect(sessions.recordPinFailure(session)).toBe('call_locked');
  });

  it('locks every call after too many failures, until they age out', () => {
    const time = clock();
    const sessions = new CallSessions({ globalFailureLimit: 4, globalFailureWindowMs: 60_000, now: time.now });
    for (const id of ['a', 'b']) {
      const session = sessions.open(id);
      sessions.recordPinFailure(session);
      sessions.recordPinFailure(session);
    }
    expect(sessions.isGloballyLocked()).toBe(true);
    time.advance(60_001);
    expect(sessions.isGloballyLocked()).toBe(false);
  });

  it('drops sessions older than the TTL', () => {
    const time = clock();
    const sessions = new CallSessions({ sessionTtlMs: 1000, now: time.now });
    sessions.open('old');
    time.advance(1000);
    expect(sessions.get('old')).toBeUndefined();
  });
});
