# Sigmail setup and run guide

Follow this from top to bottom to get from a fresh copy of the repo to a phone call that reads your Gmail. Each step ends with **You should see**. If you don't see it, stop and fix that step before going on.

PowerShell users: `cp` works as written. Run every command from the project folder.

---

## 1. Before you start

- [ ] **Node.js 22 or newer.** Check with `node --version`.
- [ ] **ngrok,** signed in (`ngrok config add-authtoken <token>`). Claim the free static domain on the [ngrok dashboard](https://dashboard.ngrok.com/domains) so your URL never changes.
- [ ] **A SignalWire account** and a phone number in your Space.
- [ ] **The Google account** whose Gmail you want read, plus access to [Google Cloud Console](https://console.cloud.google.com/).
- [ ] About 20 minutes.

---

## 2. Configuration you need

### 2a. `.env` (copy from `.env.example`)

| Variable | Required | Example | Where it comes from | If it's wrong or missing |
|---|---|---|---|---|
| `SWML_BASIC_AUTH_USER` | **Yes** | `sigmail` | You choose it | Server won't start |
| `SWML_BASIC_AUTH_PASSWORD` | **Yes** | a long random string | You choose it (e.g. a password manager) | Server won't start |
| `SWML_PROXY_URL_BASE` | **Yes, for real calls** | `https://your-name.ngrok-free.dev` | Your ngrok domain (step 3.5) | The agent answers but every tool fails |
| `SIGNALWIRE_SIGNING_KEY` | Optional | `PSKxxxxxxxx` | SignalWire Dashboard → **API** → Signing Key | Empty means signature checks are off |
| `ALLOWED_CALLERS` | **Yes** | `+15551234567,phone1@your-space.sip.signalwire.com` | Your phone numbers in E.164 format (`+`, country code, no spaces), or SIP addresses for softphones | Server won't start, or your calls get the goodbye message |
| `CALLER_PIN` | **Yes** | `482913` | You choose 4 to 8 digits | Server won't start |
| `TIMEZONE` | No (default `UTC`) | `America/New_York` | [IANA zone name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) | Wrong "today at 3 PM" times; an invalid name stops startup |
| `AGENT_VOICE` | No (default `inworld.Mark`) | `inworld.Mark` | A SignalWire TTS voice | Default voice |
| `PORT` | No (default `3000`) | `3000` | Must match the ngrok port | ngrok can't reach the server |
| `GMAIL_CREDENTIALS_PATH` | No (default `secrets/credentials.json`) | | | "Cannot read …" at startup |
| `GMAIL_TOKEN_PATH` | No (default `secrets/token.json`) | | | "Run npm run authorize first" |

### 2b. Secret files (in `secrets/`, never committed)

| File | How you get it | Shape (fake values) |
|---|---|---|
| `secrets/credentials.json` | Download it from Google Cloud (step 3.2) | `{"installed":{"client_id":"123-abc.apps.googleusercontent.com","client_secret":"GOCSPX-xxxx",...}}` |
| `secrets/token.json` | Written by `npm run authorize` (step 3.4) | `{"type":"authorized_user","client_id":"…","client_secret":"…","refresh_token":"1//0gxxxx"}` |

Anyone holding `token.json` can read your mail, so keep it private. To revoke it, remove the app at <https://myaccount.google.com/permissions>.

### 2c. Google Cloud settings

| Setting | Value |
|---|---|
| API | **Gmail API**, enabled |
| Audience / user type | **External** |
| Publishing status | **In production** (in *Testing*, the token expires after 7 days) |
| Scope | `https://www.googleapis.com/auth/gmail.readonly` |
| OAuth client type | **Desktop app** |

### 2d. SignalWire Dashboard settings

| Setting | Value |
|---|---|
| Resource | **Script → SWML Script → External URL** |
| Primary Script URL | `https://USER:PASSWORD@your-name.ngrok-free.dev/` (your `SWML_BASIC_AUTH_*` values) |
| Phone number → Inbound Call Settings | Assign the script resource above |
| Signing Key (optional) | Dashboard → **API**; goes in `SIGNALWIRE_SIGNING_KEY` |

### 2e. Where to get each value

- **`SWML_BASIC_AUTH_USER`:** any short name, such as `sigmail`.
- **`SWML_BASIC_AUTH_PASSWORD`:** generate one with the command below. It ends up inside the dashboard URL (`USER:PASSWORD@...`), so don't use `@`, `:`, `/` or `#` in a password you make up yourself. The output of this command is URL-safe:
  ```bash
  node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
  ```
- **`SWML_PROXY_URL_BASE`:** on the [ngrok dashboard](https://dashboard.ngrok.com/domains), open **Domains** and copy your static domain. Add `https://` in front and nothing after it, for example `https://your-name.ngrok-free.dev`.
- **`SIGNALWIRE_SIGNING_KEY`:** sign in to your SignalWire Space, open **API**, and copy the **Signing Key**. Leave it empty on the first run, then follow step 5.5.
- **`ALLOWED_CALLERS`:** the phones you'll call from, in E.164 format. Start with `+` and the country code, then the number with no spaces, dashes or brackets. A US number (555) 123-4567 becomes `+15551234567`. Separate several numbers with commas.
- **`CALLER_PIN`:** make up 4 to 8 digits. Don't reuse your bank or phone PIN.
- **`TIMEZONE`:** print your computer's zone with the command below. Its output (for example `America/New_York`) is the value:
  ```bash
  node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"
  ```
- **`AGENT_VOICE`, `PORT`, `GMAIL_*_PATH`:** keep the defaults unless you have a reason to change them.
- **`secrets/credentials.json`:** downloaded from Google Cloud in step 3.2.
- **`secrets/token.json`:** don't create it by hand; `npm run authorize` writes it in step 3.4.

---

## 3. Run it, step by step

### 3.1 Install

```bash
npm install
```

**You should see:** `found 0 vulnerabilities`, and no errors.

### 3.2 Google Cloud: create the OAuth client

1. In Google Cloud Console, create or select a project.
2. Go to **APIs & Services → Library → Gmail API** and click **Enable**.
3. In **Google Auth Platform** (the "OAuth consent screen" in older consoles), set:
   - **Branding:** an app name and your email
   - **Audience:** **External**, then **Publish app** (status **In production**)
   - **Data Access:** add the scope `.../auth/gmail.readonly`
4. Go to **Clients → Create client → Desktop app → Create**, then click **Download JSON** in the dialog that appears. This is your only chance: the client's page no longer offers the download or shows the secret later.
5. Save the file as `secrets/credentials.json` in this project. Create the `secrets` folder if it doesn't exist.

Missed the download, or lost the file? Open the client, click **Add secret**, and copy the new secret right away (it's shown once). Then write `secrets/credentials.json` yourself, with the Client ID from that page:
```json
{"installed":{"client_id":"123-abc.apps.googleusercontent.com","client_secret":"GOCSPX-xxxx"}}
```
Run step 3.4 again, then disable the old secret on the client's page.

**You should see:** `secrets/credentials.json` with an `"installed"` section in it.

### 3.3 Create `.env`

```bash
cp .env.example .env
```

Fill in the values from [section 2a](#2a-env-copy-from-envexample). You don't know `SWML_PROXY_URL_BASE` yet, so leave it until step 3.6.

### 3.4 Connect Gmail (one time)

```bash
npm run authorize
```

A browser opens. Sign in as the Gmail account to read, and accept. If Google shows "Google hasn't verified this app", click **Advanced → Go to … (unsafe)**. That's expected for your own unverified app.

**You should see:**
```
Saved secrets/token.json
Connected to you@gmail.com: 12 unread in the inbox.
```

### 3.5 Start ngrok (terminal 1)

```bash
ngrok http 3000 --url=https://your-name.ngrok-free.dev
```

**You should see:** `Forwarding https://your-name.ngrok-free.dev -> http://localhost:3000`. Leave it running.

### 3.6 Start the server (terminal 2)

Set `SWML_PROXY_URL_BASE=https://your-name.ngrok-free.dev` in `.env`, then run:

```bash
npm run dev
```

**You should see:**
```
[sigmail] Gmail connected: 12 unread in the inbox
[sigmail] Allowlisted callers: 1
... Agent 'sigmail' running at http://0.0.0.0:3000/
... Proxy URL: https://your-name.ngrok-free.dev
```

The warning `webhook signature validation is disabled` is normal until you set the signing key (step 5.5).

### 3.7 Check the public URL (terminal 3)

```bash
curl -u USER:PASSWORD -X POST https://your-name.ngrok-free.dev/
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://your-name.ngrok-free.dev/
```

**You should see:**
- **First command:** SWML JSON containing `"play"` and `"hangup"`. That's correct: curl isn't an allowlisted caller.
- **Second command:** `401`.

### 3.8 Point the SignalWire number at the server

1. In the SignalWire Dashboard, create a resource: **Script → SWML Script → External URL**, and set the URL to `https://USER:PASSWORD@your-name.ngrok-free.dev/`.
2. Go to **Phone Numbers**, open your number, and under **Inbound Call Settings** assign the resource. Save.

### 3.9 Call it

Call the number from a phone in `ALLOWED_CALLERS`.

**You should hear:** a greeting and a request for your PIN. Say it, then try "check my inbox", "read number one", or "any emails from Amazon this week?".

**In the server log:** `Accepted call …`, then `PIN accepted on call …`.

---

## 4. Daily use

- **Each time:** run `ngrok http 3000 --url=https://your-name.ngrok-free.dev` and `npm run dev`. The static domain means nothing changes in SignalWire.
- **Use `npm start`** instead of `npm run dev` if you don't want it to restart on file changes.
- **If the log shows `invalid_grant`:** run `npm run authorize` again. If it keeps happening every week, the Google app is still in *Testing* (see 2c).
- **To add or remove a caller:** edit `ALLOWED_CALLERS`, then restart.

---

## 5. Testing

Work through the levels in order; each one needs a bit more set up.

### 5.1 Automated tests (no accounts needed)

```bash
npm test
npm run typecheck
```

**You should see:** `Tests 101 passed`, and no type errors. These tests use a fake mailbox, so they run without Gmail or SignalWire.

### 5.2 Inspect the agent (no phone call; needs `.env` and the token)

```bash
npm run swaig -- --from-number +15551234567 --list-tools   # use a number in ALLOWED_CALLERS
npm run swaig -- --from-number +15559990000 --dump-swml    # a number NOT in the list
```

**You should see:**
- **First command:** 5 functions (`hangup_hook`, `verify_pin`, `check_inbox`, `search_emails`, `read_email`).
- **Second command:** SWML whose main section starts with `answer`, `play`, `hangup`.

`--exec` on the email tools returns "not verified". That's correct: the tool makes up a new call, and that call never passed the PIN.

### 5.3 Watch real traffic

Open the ngrok inspector at <http://127.0.0.1:4040> while you call. It shows every request SignalWire sends and every response the server returns.

### 5.4 Live call checklist

| Test | Expected |
|---|---|
| Allowlisted phone, right PIN | "PIN accepted", then the agent offers to check the inbox |
| "Check my inbox" → "read number one" | Numbered list, then the email (summarized first if it's long) |
| Afterwards, look in Gmail | The email you heard is **still unread** (read-only access) |
| "Find emails from <sender> this week" | A list of matching emails |
| Wrong PIN three times | Agent says goodbye and hangs up |
| Call from a phone that isn't listed | "Sorry, this line isn't available. Goodbye." The log shows `Rejected call from ...1234` |

### 5.5 Test `SIGNALWIRE_SIGNING_KEY` (optional hardening)

1. Copy the Signing Key from the SignalWire Dashboard → **API** into `.env` as `SIGNALWIRE_SIGNING_KEY=...`. Keep `SWML_PROXY_URL_BASE` exactly equal to your ngrok URL, then restart `npm run dev`.
   **You should see:** the `webhook signature validation is disabled` warning is gone.
2. **Negative test:** rerun the first curl from step 3.7 (`curl -u USER:PASSWORD -X POST https://your-name.ngrok-free.dev/`).
   **You should see:** it is **rejected** (no SWML JSON). The password is right but there's no SignalWire signature, which proves the check is on.
3. **Positive test:** call the number. It should work exactly as before.
4. **If the real call now fails:** check the response codes in the ngrok inspector. The usual cause is `SWML_PROXY_URL_BASE` not matching the URL SignalWire posts to, for example http instead of https, or a trailing path. Fix it, or clear the key to turn the check off.

---

## 6. Troubleshooting

See [README → Troubleshooting](README.md#troubleshooting) for the common problems: caller ID format, a dashboard URL missing `USER:PASSWORD@`, `invalid_grant`, and a wrong `SWML_PROXY_URL_BASE`.
