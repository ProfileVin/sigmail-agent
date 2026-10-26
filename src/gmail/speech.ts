import type { gmail_v1 } from '@googleapis/gmail';
import { convert } from 'html-to-text';

type MessagePart = gmail_v1.Schema$MessagePart;

/** Roughly two minutes of speech; longer bodies are cut and flagged. */
export const MAX_SPOKEN_BODY_CHARS = 2500;

function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8');
}

/** Depth-first search for an inline (non-attachment) part of the given type. */
function findInlinePart(part: MessagePart, mimeType: string): MessagePart | undefined {
  if (part.mimeType === mimeType && part.body?.data && !part.filename) return part;
  for (const child of part.parts ?? []) {
    const found = findInlinePart(child, mimeType);
    if (found) return found;
  }
  return undefined;
}

export function htmlToPlainText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
    ],
  });
}

/** Body text of a Gmail message payload, preferring text/plain over text/html. */
export function extractBodyText(payload: MessagePart | undefined): string {
  if (!payload) return '';
  const plain = findInlinePart(payload, 'text/plain');
  if (plain?.body?.data) return decodeBase64Url(plain.body.data);
  const html = findInlinePart(payload, 'text/html');
  if (html?.body?.data) return htmlToPlainText(decodeBase64Url(html.body.data));
  return '';
}

export function listAttachmentNames(payload: MessagePart | undefined): string[] {
  if (!payload) return [];
  const names: string[] = [];
  const walk = (part: MessagePart): void => {
    if (part.filename) names.push(part.filename);
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return names;
}

/** Where earlier messages in a reply chain, or the signature, begin. */
const HISTORY_MARKERS: RegExp[] = [
  /^On [^\n]{1,200}(\n[^\n]{0,200})?wrote:\s*$/m, // Gmail / Apple Mail, sometimes wrapped
  /^-{2,}\s*Original Message\s*-{2,}/im, // Outlook classic
  /^From: [^\n]+\n(Sent|Date): /m, // Outlook reply header
  /^-- ?$/m, // RFC 3676 signature delimiter
];

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;
const INVISIBLE_CHARS = /[­͏​-‏⁠﻿]/g;

export interface SpeakableBody {
  text: string;
  truncated: boolean;
}

/**
 * Prepares an email body to be read aloud: drops quoted history, the
 * signature and quoted lines, replaces URLs, and caps the length.
 */
export function cleanForSpeech(raw: string, maxChars = MAX_SPOKEN_BODY_CHARS): SpeakableBody {
  let text = raw.replace(/\r\n?/g, '\n').replace(INVISIBLE_CHARS, '');

  const cut = Math.min(
    ...HISTORY_MARKERS.map((marker) => marker.exec(text)?.index ?? Infinity),
  );
  if (Number.isFinite(cut)) text = text.slice(0, cut);

  text = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .replace(URL_PATTERN, 'a link')
    .replace(/\ba link(\s+a link)+/g, 'a few links')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text.length <= maxChars) return { text, truncated: false };
  const slice = text.slice(0, maxChars);
  const sentenceEnd = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('.\n'));
  const end = sentenceEnd > maxChars * 0.6 ? sentenceEnd + 1 : slice.lastIndexOf(' ');
  return { text: slice.slice(0, end > 0 ? end : maxChars).trim(), truncated: true };
}

/** `"Jane Doe" <jane@example.com>` becomes `Jane Doe`; a bare address stays as is. */
export function speakableSender(from: string | undefined | null): string {
  const value = (from ?? '').trim();
  const match = /^"?([^"<]*?)"?\s*<([^>]+)>$/.exec(value);
  if (match) return match[1]?.trim() || match[2]!.trim();
  return value || 'an unknown sender';
}

function calendarDay(date: Date, timeZone: string): number {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date).split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
}

/** "today at 3:15 PM", "yesterday at 9:02 AM", "Monday at 8:30 PM", "October 3", "March 9, 2025". */
export function speakableWhen(date: Date | null, now: Date, timeZone: string): string {
  if (!date || Number.isNaN(date.getTime())) return 'at an unknown time';
  // ICU puts a narrow no-break space before AM/PM; plain spaces are safer for TTS.
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
    .format(date)
    .replace(/\s/g, ' ');
  const daysAgo = calendarDay(now, timeZone) - calendarDay(date, timeZone);
  if (daysAgo === 0) return `today at ${time}`;
  if (daysAgo === 1) return `yesterday at ${time}`;
  if (daysAgo > 1 && daysAgo < 7) {
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(date);
    return `${weekday} at ${time}`;
  }
  const sameYear =
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(date) ===
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(now);
  return new Intl.DateTimeFormat('en-US', {
    timeZone, month: 'long', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}
