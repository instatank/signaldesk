# SignalDesk — Setup Guide

Everything you need to do by hand, step by step. Assume ~30 minutes total.
You'll do 5 things: create a Telegram bot, get your chat ID, set up
Firestore, deploy to Vercel with your secrets, and test it.

Keep a notes file open — you'll collect **5 secret values** along the way
and paste them all into Vercel in step 4.

> **Status: Steps 1–4 are done.** The app is live at
> **https://signaldesk-tawny.vercel.app**, all 5 env vars are set, and it's
> git-connected so future pushes to `claude/new-session-8uz6j0` redeploy it
> automatically. **Step 5 (testing) is the next thing to do.** Steps 1–4
> below are left in place for reference (re-setup, rotating a secret,
> onboarding a second machine, etc.) — skip straight to Step 5 unless you
> need one of those.

---

## Step 1 — Create your Telegram bot (~3 min)

1. Open Telegram and search for **@BotFather** (blue checkmark, official).
2. Tap **Start**, then send the message: `/newbot`
3. It asks for a display name. Type something like: `SignalDesk`
4. It asks for a username ending in "bot". Type something unique like:
   `my_signaldesk_bot` (if taken, add numbers: `my_signaldesk_2026_bot`)
5. BotFather replies with a message containing your **bot token** — it looks
   like `1234567890:AAHfj3k...`. **Copy it into your notes** as
   `TELEGRAM_BOT_TOKEN`. Treat it like a password.

## Step 2 — Get your chat ID (~2 min)

The bot needs to know *your* chat to message you.

1. In Telegram, search for the bot username you just created and tap
   **Start** (this is important — bots can't message you first).
2. Send it any message, e.g. "hello".
3. In a web browser, open this URL, replacing `<TOKEN>` with your bot token:
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
4. You'll see a wall of text. Find `"chat":{"id":` followed by a number,
   e.g. `"chat":{"id":123456789,`. That number is your **chat ID**.
   **Copy it into your notes** as `TELEGRAM_CHAT_ID`.
   - If you see `"result":[]` (empty), send the bot another message and
     refresh the page.

## Step 3 — Set up Firestore (~7 min)

1. Go to https://console.firebase.google.com and sign in with Google.
2. Click **Create a Firebase project** (or "Add project").
3. Name it `signaldesk`, click **Continue**.
4. Turn **off** Google Analytics when asked (not needed), click
   **Create project**, wait, then **Continue**.
5. In the left sidebar, click **Build → Firestore Database**.
6. Click **Create database**.
   - Location: choose **asia-south1 (Mumbai)** — closest to you.
   - Start in **production mode** (locked down; our server key bypasses
     rules, and nothing else should have access). Click **Create**.
7. Now get the server key: click the **gear icon → Project settings** (top
   of left sidebar), then the **Service accounts** tab.
8. Click **Generate new private key**, confirm. A `.json` file downloads.
9. Open that file in a text editor and **copy the ENTIRE contents** into
   your notes as `FIREBASE_SERVICE_ACCOUNT`. Never commit this file to git.

## Step 4 — Deploy to Vercel (~10 min)

First, generate one more secret. In any terminal run:
```
openssl rand -hex 32
```
(or just mash 40+ random letters/numbers). Copy the result into your notes
as `CRON_SECRET`. This is the password that protects your pipeline
endpoints.

Also grab your **Anthropic API key** from https://console.anthropic.com →
**API Keys** → Create Key. Copy it as `ANTHROPIC_API_KEY`.

Now deploy:

1. Push this repository to your GitHub account (if it isn't already).
2. Go to https://vercel.com, sign in with GitHub.
3. Click **Add New… → Project**, find the `signaldesk` repo, click
   **Import**.
4. Before clicking Deploy, expand **Environment Variables** and add all 5,
   one at a time (Name on the left, value on the right):

   | Name | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your Anthropic key |
   | `TELEGRAM_BOT_TOKEN` | from step 1 |
   | `TELEGRAM_CHAT_ID` | from step 2 |
   | `CRON_SECRET` | your random string |
   | `FIREBASE_SERVICE_ACCOUNT` | the whole JSON file contents (paste it all — multi-line is fine) |

5. Click **Deploy**. Wait ~2 minutes for the green confetti.
6. Note your deployment URL, e.g. `https://signaldesk-xyz.vercel.app`.

   *(Already done for this project — see the status note at the top of
   this file. If you ever need a second deployment or the Git connection
   breaks, use this flow: on the project's **Settings → Git** page, click
   **Connect Git Repository** and pick `instatank/signaldesk` — it will
   auto-select `claude/new-session-8uz6j0` as the production branch, which
   is what you want, since that's the only branch and Vercel Cron only
   runs on production deployments.)*

### ⚠️ Cron schedules on the free (Hobby) plan

`vercel.json` schedules two cron jobs: ingest every 15 minutes and the
digest daily at 07:00 IST. **Vercel's free Hobby plan only runs cron jobs
once per day** (and not at an exact minute). Two options:

- **Option A (free, recommended to start):** let Vercel handle only the
  daily digest, and use a free external pinger for the 15-minute ingest:
  1. Go to https://cron-job.org and create a free account.
  2. **Create cronjob** → URL: `https://signaldesk-tawny.vercel.app/api/ingest`
  3. Schedule: every 15 minutes.
  4. Under **Advanced → Headers**, add header name `Authorization` with
     value `Bearer YOUR-CRON-SECRET` (the word "Bearer", a space, then
     your secret).
  5. Save. Done — ingest now runs every 15 minutes for free.
- **Option B ($20/mo):** upgrade Vercel to Pro; both schedules in
  `vercel.json` then just work with no extra setup.

## Step 5 — Test it (~5 min)

Your app is at **https://signaldesk-tawny.vercel.app**. Replace
`YOUR-CRON-SECRET` with the value you saved in step 4 in the commands
below (run in any terminal; on Windows use Git Bash or PowerShell's
`curl.exe`).

1. **Verify the data sources are alive** (run from your own computer,
   inside the project folder, after `npm install`):
   ```
   npm run verify:sources
   ```
   Everything should be ✅ except possibly Binance (expected if you're
   testing from a region it blocks — production runs from Singapore).

2. **Trigger an ingest run:**
   ```
   curl -H "Authorization: Bearer YOUR-CRON-SECRET" https://signaldesk-tawny.vercel.app/api/ingest
   ```
   You should get back JSON with `"ok": true`, a count of new headlines,
   and which source (binance/okx) served each coin. Check the Firebase
   console → Firestore → you should see `headlines` and `metrics`
   collections filling up.

3. **Check security** — this must return `{"error":"unauthorized"}`:
   ```
   curl https://signaldesk-tawny.vercel.app/api/ingest
   ```

4. **Trigger your first digest** (do this after at least one ingest run):
   ```
   curl -H "Authorization: Bearer YOUR-CRON-SECRET" https://signaldesk-tawny.vercel.app/api/digest
   ```
   Within ~30 seconds your Telegram bot should message you the briefing. 🎉

From tomorrow, the digest arrives automatically at 07:00 IST.

---

## If something breaks

- **No Telegram message but the curl said `"telegram": "sent"`** — check
  you started the chat with the bot (step 2.1) and the chat ID is right.
- **`"degraded": true` in the digest response** — the Claude call failed;
  you still got the raw-data message. Check `ANTHROPIC_API_KEY` and your
  Anthropic account credit.
- **`unauthorized` on your own curl** — the header must be exactly
  `Authorization: Bearer <secret>` with a space after "Bearer".
- **Firestore errors** — re-paste `FIREBASE_SERVICE_ACCOUNT` in Vercel
  (Settings → Environment Variables), make sure you copied the whole JSON
  including the outer `{ }`, then redeploy.
- **A news feed dies** — the run continues without it (you'll see it in
  the `errors` array). Feed URLs live in `config/sources.json`; edit or
  remove the dead one and redeploy.
