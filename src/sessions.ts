export interface CallSession {
  readonly callId: string;
  readonly startedAt: number;
  /** True once the caller has said the correct PIN. */
  unlocked: boolean;
  pinAttempts: number;
  /** Gmail message ids of the current list across every page read so far, in spoken order. */
  lastResults: string[];
  /** The search behind the current list, so more_emails can fetch its next page. */
  lastSearch?: ListSearch;
}

export interface ListSearch {
  query: string;
  pageSize: number;
  markUnread: boolean;
  nextPageToken?: string;
}

export interface CallSessionsOptions {
  maxPinAttempts?: number;
  /** Failures across all calls that lock every PIN attempt until they age out. */
  globalFailureLimit?: number;
  globalFailureWindowMs?: number;
  /** Sessions older than this are dropped even if the hangup hook never fired. */
  sessionTtlMs?: number;
  now?: () => number;
}

export type PinFailureOutcome = 'retry' | 'call_locked';

/**
 * In-memory state for calls that passed the caller-ID allowlist. A call with
 * no session here is treated as unverified everywhere. Single-process only:
 * running more than one server instance needs a shared store instead.
 */
export class CallSessions {
  readonly maxPinAttempts: number;
  private readonly globalFailureLimit: number;
  private readonly globalFailureWindowMs: number;
  private readonly sessionTtlMs: number;
  private readonly now: () => number;
  private readonly sessions = new Map<string, CallSession>();
  private failureTimes: number[] = [];

  constructor(opts: CallSessionsOptions = {}) {
    this.maxPinAttempts = opts.maxPinAttempts ?? 3;
    this.globalFailureLimit = opts.globalFailureLimit ?? 10;
    this.globalFailureWindowMs = opts.globalFailureWindowMs ?? 60 * 60 * 1000;
    this.sessionTtlMs = opts.sessionTtlMs ?? 60 * 60 * 1000;
    this.now = opts.now ?? Date.now;
  }

  /** Returns the call's session, creating it on first sight. */
  open(callId: string): CallSession {
    this.sweep();
    let session = this.sessions.get(callId);
    if (!session) {
      session = { callId, startedAt: this.now(), unlocked: false, pinAttempts: 0, lastResults: [] };
      this.sessions.set(callId, session);
    }
    return session;
  }

  get(callId: string | undefined): CallSession | undefined {
    if (!callId) return undefined;
    this.sweep();
    return this.sessions.get(callId);
  }

  close(callId: string | undefined): void {
    if (callId) this.sessions.delete(callId);
  }

  isGloballyLocked(): boolean {
    this.pruneFailures();
    return this.failureTimes.length >= this.globalFailureLimit;
  }

  recordPinFailure(session: CallSession): PinFailureOutcome {
    session.pinAttempts += 1;
    this.failureTimes.push(this.now());
    return session.pinAttempts >= this.maxPinAttempts ? 'call_locked' : 'retry';
  }

  private pruneFailures(): void {
    const cutoff = this.now() - this.globalFailureWindowMs;
    this.failureTimes = this.failureTimes.filter((t) => t > cutoff);
  }

  private sweep(): void {
    const cutoff = this.now() - this.sessionTtlMs;
    for (const [id, session] of this.sessions) {
      if (session.startedAt <= cutoff) this.sessions.delete(id);
    }
  }
}
