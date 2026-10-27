import type { gmail_v1 } from '@googleapis/gmail';
import { extractBodyText, listAttachmentNames } from './speech.js';

export interface EmailSummary {
  id: string;
  from: string;
  subject: string;
  date: Date | null;
  unread: boolean;
}

export interface EmailDetail extends EmailSummary {
  body: string;
  attachments: string[];
}

export interface SearchPage {
  emails: EmailSummary[];
  /** Present when more results follow; pass it back to `search` for the next page. */
  nextPageToken?: string;
}

/** Read-only view of one mailbox; the tools depend on this, not on Gmail. */
export interface Mailbox {
  unreadCount(): Promise<number>;
  search(query: string, max: number, pageToken?: string): Promise<SearchPage>;
  read(id: string): Promise<EmailDetail>;
}

function header(message: gmail_v1.Schema$Message, name: string): string {
  const wanted = name.toLowerCase();
  return message.payload?.headers?.find((h) => h.name?.toLowerCase() === wanted)?.value ?? '';
}

function toSummary(message: gmail_v1.Schema$Message): EmailSummary {
  const internal = Number(message.internalDate);
  return {
    id: message.id ?? '',
    from: header(message, 'From'),
    subject: header(message, 'Subject'),
    date: Number.isFinite(internal) && internal > 0 ? new Date(internal) : null,
    unread: message.labelIds?.includes('UNREAD') ?? false,
  };
}

/**
 * Mailbox backed by the Gmail API. Uses only read calls, so with the
 * gmail.readonly scope nothing is modified (opening a message does not
 * mark it read).
 */
export class GmailMailbox implements Mailbox {
  constructor(private readonly gmail: gmail_v1.Gmail) {}

  async unreadCount(): Promise<number> {
    const { data } = await this.gmail.users.labels.get({ userId: 'me', id: 'INBOX' });
    return data.messagesUnread ?? 0;
  }

  async search(query: string, max: number, pageToken?: string): Promise<SearchPage> {
    const { data } = await this.gmail.users.messages.list({ userId: 'me', q: query, maxResults: max, pageToken });
    const ids = (data.messages ?? []).flatMap((m) => (m.id ? [m.id] : []));
    const emails = await Promise.all(
      ids.map(async (id) => {
        const res = await this.gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });
        return toSummary(res.data);
      }),
    );
    return { emails, nextPageToken: data.nextPageToken ?? undefined };
  }

  async read(id: string): Promise<EmailDetail> {
    const { data } = await this.gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    return {
      ...toSummary(data),
      body: extractBodyText(data.payload),
      attachments: listAttachmentNames(data.payload),
    };
  }
}
