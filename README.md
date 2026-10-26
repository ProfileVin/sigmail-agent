# Sigmail Agent

A phone number you can call to have an AI agent read your Gmail to you. It runs on SignalWire's AI agent platform.

> "Check my inbox." · "Read number two." · "Any emails from Amazon this week?"

Access is **read-only** (`gmail.readonly`). The agent can list unread mail, search, and read messages aloud. It cannot send, delete, archive, or mark anything as read.

## How a call works

```
caller ──► SignalWire number ──► POST /  (this server, via ngrok)
                                   │
          not on ALLOWED_CALLERS ──┼──► "Sorry, this line isn't available." → hang up
                                   │
              on ALLOWED_CALLERS ──┴──► AI agent starts, asks for the PIN
                                          │  verify_pin (3 tries, then hang up)
                                          ▼
                       check_inbox · search_emails · read_email ──► Gmail API
```

SignalWire runs the speech recognition, the language model and the voice. This server provides two things:

- the agent's instructions, as a SWML document
- the tools the agent calls, as SWAIG webhooks

Security layers, from the outside in:

1. **HTTP basic auth** on every request (`SWML_BASIC_AUTH_USER` / `SWML_BASIC_AUTH_PASSWORD`).
2. **Optional SignalWire signature check** (`SIGNALWIRE_SIGNING_KEY`).
3. **Caller-ID allowlist.** The server fails closed: by default every call hears a goodbye and is hung up, and only an allowlisted caller ever gets the AI and its tools.
4. **Per-call tool tokens** from the SDK. A tool request from a call the server never accepted finds no tool to run.
5. **Spoken PIN.** The comparison is constant-time. A call ends after 3 wrong attempts, and after 10 failures in an hour every PIN is refused until the hour passes. Each email tool checks on the server that the call is unlocked, and refuses without touching Gmail until it is.
6. **Email content is untrusted.** Tool results tell the model not to follow instructions found in an email. The model never sees the PIN, and every tool is read-only.

Caller ID can be spoofed, which is why the PIN exists. Pick one that isn't easy to guess.

## Requirements

- Node.js 22 or newer
- A SignalWire account with a phone number
- A Google account (the Gmail inbox to read) and access to Google Cloud Console
- [ngrok](https://ngrok.com), or any other way to give this server a public HTTPS URL

## Setup

> For a step-by-step checklist with a complete configuration reference and testing steps, see **[SETUP.md](SETUP.md)**.

### 1. Google Cloud: create an OAuth client

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project, or pick an existing one.
2. Go to **APIs & Services → Library**, find the **Gmail API**, and turn it on with **Enable**.
3. Open **Google Auth Platform** (called the OAuth consent screen in older consoles) and set it up:
   1. **Branding:** set any app name and your email.
   2. **Audience:** choose **External**, then **Publish app** so the status is **In production**.
      > In *Testing* status Google expires refresh tokens after 7 days, so the phone line would stop working every week. While the app is unverified you'll see an "unverified app" warning when you sign in. That's fine for an app only you use.
   3. **Data Access:** add the scope `https://www.googleapis.com/auth/gmail.readonly`.
4. Go to **Clients → Create client**, choose application type **Desktop app**, and create it. Download the JSON file and save it as `secrets/credentials.json` in this folder.

### 2. Install and configure

```bash
npm install
cp .env.example .env
```

Edit `.env`:

| Variable | What to put |
|---|---|
| `SWML_BASIC_AUTH_USER` / `SWML_BASIC_AUTH_PASSWORD` | A username and a long random password. They go into the SignalWire URL in step 5. |
| `SWML_PROXY_URL_BASE` | Your public HTTPS URL, e.g. `https://your-name.ngrok-free.dev` (step 4). |
| `SIGNALWIRE_SIGNING_KEY` | Optional. Your Space's signing key (Dashboard → API). See [Troubleshooting](#troubleshooting). |
| `ALLOWED_CALLERS` | The phone numbers allowed to call, in E.164 format, separated by commas: `+15551234567,+15557654321`. |
| `CALLER_PIN` | 4 to 8 digits. Avoid something easy to guess, like `1234`. |
| `TIMEZONE` | Your IANA time zone, e.g. `America/New_York`. Used for "today at 3:15 PM". |
| `AGENT_VOICE` | A SignalWire TTS voice (default `inworld.Mark`). |

### 3. Connect Gmail

```bash
npm run authorize
```

A browser opens with Google's sign-in. Sign in as the Gmail account the line should read, and allow read access. The script saves `secrets/token.json` and prints the account's address and unread count. You only do this once, or again whenever the token is revoked.

### 4. Run the server and expose it

```bash
npm run dev            # or: npm start
```

In a second terminal:

```bash
ngrok http 3000
# A free static domain keeps the URL the same between restarts:
ngrok http 3000 --url=https://your-name.ngrok-free.dev
```

Put the HTTPS URL in `SWML_PROXY_URL_BASE` and restart the server. Then confirm it answers:

```bash
curl -u USER:PASSWORD -X POST https://your-name.ngrok-free.dev/   # SWML JSON
curl -X POST https://your-name.ngrok-free.dev/                    # 401
```

### 5. SignalWire: point a number at the server

1. In the SignalWire Dashboard, buy a phone number, or use one you have.
2. Create a resource: **Script → SWML Script → External URL**. As the Primary Script URL, enter
   `https://USER:PASSWORD@your-name.ngrok-free.dev/`
   using your `SWML_BASIC_AUTH_*` values.
3. Open the phone number's settings. Under **Inbound Call Settings**, assign the script resource.

Call the number from a phone listed in `ALLOWED_CALLERS`, say your PIN, and ask about your email.

## Development

```bash
npm test             # unit and HTTP-level tests (no network, no Gmail)
npm run typecheck

# Inspect the agent without a call (uses .env and your Gmail token files):
npm run swaig -- --from-number +15551234567 --list-tools
npm run swaig -- --from-number +15551234567 --dump-swml
npm run swaig -- --from-number +15559990000 --dump-swml   # caller not on the list: play + hangup
```

| Path | Purpose |
|---|---|
| `src/index.ts` | Entry point: loads config, connects Gmail, starts the server |
| `src/agent.ts` | Agent prompt, voice, fail-closed caller gate |
| `src/tools.ts` | `verify_pin`, `check_inbox`, `search_emails`, `read_email` |
| `src/sessions.ts` | Per-call state: unlock, PIN attempts, last list read, lockout |
| `src/security.ts` | Phone number normalization and PIN comparison |
| `src/gmail/` | OAuth client, Gmail mailbox, text cleanup for speech |
| `scripts/authorize.ts` | The one-time Gmail sign-in |

Call state lives in memory, so run a single server process. To run more than one, the state would have to move to a shared store.

## Troubleshooting

| Symptom | Fix |
|---|---|
| The call says "this line isn't available" and hangs up | Your caller ID isn't in `ALLOWED_CALLERS` exactly as SignalWire sends it (E.164 with `+` and country code). The server log shows the last 4 digits of rejected numbers. |
| The call fails or is silent right away | Check the URL in the SignalWire resource, including `USER:PASSWORD@`, and that ngrok and the server are both running. Run the `curl` checks above. |
| The agent answers, but tools fail | `SWML_PROXY_URL_BASE` must be the public URL SignalWire can reach. Restart after you change it. |
| `invalid_grant` in the log | The Gmail token expired or was revoked, or the Google app is still in *Testing*. Publish the app (step 1) and run `npm run authorize` again. |
| Every request fails after you set `SIGNALWIRE_SIGNING_KEY` | Signature checks rebuild the signed URL from `SWML_PROXY_URL_BASE`, so the two must match. Leave the key empty to turn the check off. |
