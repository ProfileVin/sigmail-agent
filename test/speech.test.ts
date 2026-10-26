import type { gmail_v1 } from '@googleapis/gmail';
import { describe, expect, it } from 'vitest';
import {
  cleanForSpeech,
  extractBodyText,
  listAttachmentNames,
  speakableSender,
  speakableWhen,
} from '../src/gmail/speech.js';

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
const part = (mimeType: string, text: string, filename = ''): gmail_v1.Schema$MessagePart => ({
  mimeType,
  filename,
  body: { data: b64(text) },
});

describe('extractBodyText', () => {
  it('prefers text/plain in a multipart/alternative message', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [part('text/plain', 'Plain body'), part('text/html', '<p>HTML body</p>')],
    };
    expect(extractBodyText(payload)).toBe('Plain body');
  });

  it('converts HTML when there is no plain text, dropping link targets and images', () => {
    const payload = part('text/html', '<p>Hello <a href="https://track.example.com/x">there</a></p><img src="logo.png"><p>Bye</p>');
    const text = extractBodyText(payload);
    expect(text).toContain('Hello there');
    expect(text).toContain('Bye');
    expect(text).not.toContain('track.example.com');
    expect(text).not.toContain('logo.png');
  });

  it('finds the body inside nested multipart/mixed and skips text attachments', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        part('text/plain', 'attached notes', 'notes.txt'),
        { mimeType: 'multipart/alternative', parts: [part('text/plain', 'The real body')] },
      ],
    };
    expect(extractBodyText(payload)).toBe('The real body');
  });

  it('returns an empty string when nothing is readable', () => {
    expect(extractBodyText(undefined)).toBe('');
    expect(extractBodyText({ mimeType: 'image/png', filename: 'a.png', body: { attachmentId: 'x' } })).toBe('');
  });
});

describe('listAttachmentNames', () => {
  it('lists every named part', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [part('text/plain', 'body'), { mimeType: 'application/pdf', filename: 'invoice.pdf' }, { mimeType: 'image/png', filename: 'photo.png' }],
    };
    expect(listAttachmentNames(payload)).toEqual(['invoice.pdf', 'photo.png']);
  });
});

describe('cleanForSpeech', () => {
  it('drops the quoted reply chain', () => {
    const raw = 'Sounds good, see you then.\n\nOn Mon, Oct 26, 2026 at 9:00 AM Jane Doe <jane@example.com> wrote:\n> Lunch Friday?\n> Jane';
    expect(cleanForSpeech(raw).text).toBe('Sounds good, see you then.');
  });

  it('handles a wrapped "wrote:" line and Outlook headers', () => {
    expect(cleanForSpeech('Yes.\nOn Mon, Oct 26, 2026 at 9:00 AM Jane Doe\n<jane@example.com> wrote:\nOld').text).toBe('Yes.');
    expect(cleanForSpeech('Approved.\n\nFrom: Bob\nSent: Monday\nTo: Alice').text).toBe('Approved.');
    expect(cleanForSpeech('Done.\n-----Original Message-----\nOld').text).toBe('Done.');
  });

  it('drops the signature and stray quoted lines', () => {
    expect(cleanForSpeech('Thanks!\n> quoted\nMore\n-- \nBob Smith\nCEO').text).toBe('Thanks!\nMore');
  });

  it('replaces URLs and strips invisible characters', () => {
    const { text } = cleanForSpeech('Track it at https://example.com/t?id=1 or www.example.com​ now. https://a.b/c https://d.e/f');
    expect(text).toBe('Track it at a link or a link now. a few links');
  });

  it('collapses whitespace', () => {
    expect(cleanForSpeech('Hi   there\r\n\r\n\r\n\r\nBye  ').text).toBe('Hi there\n\nBye');
  });

  it('truncates long bodies at a sentence boundary', () => {
    const raw = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const result = cleanForSpeech(raw, 300);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(300);
    expect(result.text.endsWith('.')).toBe(true);
    expect(cleanForSpeech('Short.', 300)).toEqual({ text: 'Short.', truncated: false });
  });
});

describe('speakableSender', () => {
  it.each([
    ['"Jane Doe" <jane@example.com>', 'Jane Doe'],
    ['Jane Doe <jane@example.com>', 'Jane Doe'],
    ['<jane@example.com>', 'jane@example.com'],
    ['jane@example.com', 'jane@example.com'],
    ['', 'an unknown sender'],
  ])('%j -> %j', (from, expected) => {
    expect(speakableSender(from)).toBe(expected);
  });
});

describe('speakableWhen', () => {
  // Monday, October 26, 2026, 11:00 AM in Los Angeles (PDT, UTC-7).
  const now = new Date('2026-10-26T18:00:00Z');
  const tz = 'America/Los_Angeles';

  it.each([
    ['2026-10-26T15:15:00Z', 'today at 8:15 AM'],
    ['2026-10-25T16:00:00Z', 'yesterday at 9:00 AM'],
    ['2026-10-26T06:30:00Z', 'yesterday at 11:30 PM'], // still the 25th locally
    ['2026-10-22T20:00:00Z', 'Thursday at 1:00 PM'],
    ['2026-10-03T20:00:00Z', 'October 3'],
    ['2025-03-09T20:00:00Z', 'March 9, 2025'],
  ])('%s -> %j', (iso, expected) => {
    expect(speakableWhen(new Date(iso), now, tz)).toBe(expected);
  });

  it('handles a missing date', () => {
    expect(speakableWhen(null, now, tz)).toBe('at an unknown time');
  });
});
