# Settlement Eligibility Monitor

A **free** weekly monitor that scans public class-action / settlement RSS feeds,
scores them against *your* personal eligibility profile, and emails you a digest of
*possible* matches. It runs entirely on **GitHub Actions** — no server, no database,
no paid API, no always-on machine.

- Runs `monitor.py` on a **weekly cron** (Mondays) in GitHub Actions.
- Emails via **Gmail SMTP** using a Google **App Password** (no OAuth consent screen,
  no app verification).
- Remembers what it already told you in **`seen.json`**, committed back to the repo
  each run, and re-surfaces an item only if its deadline is within 14 days.

> ⚠️ **This is not legal advice.** It suggests *possible* eligibility only. Always
> verify on the official claim site before filing. **Never pay to claim a
> settlement**, confirm the official administrator, and watch for phishing.

---

## Build your own (~15 min)

Follow these steps to stand up your own copy from scratch. Total cost: **$0** —
GitHub Actions' free tier and a Gmail account cover everything.

### What you need

- A **GitHub account** (free tier is fine).
- A **Gmail account** you're willing to send from and receive at. It can be the
  same address for both.
- No local Python, no server. The script only ever runs inside GitHub Actions.

### Step 1 — Create the repository

1. Create a new GitHub repo (private is recommended, since it holds your profile).
   You can start empty, or fork/copy this one.
2. Add these four files (copy them from this repo):
   - `monitor.py` — the whole app: fetch, score, email.
   - `.github/workflows/monitor.yml` — the weekly cron that runs `monitor.py` and
     commits `seen.json` back.
   - `seen.json` — dedup state. Start it as an empty object:
     ```bash
     echo '{}' > seen.json
     ```
     (The script also recreates it automatically if it's missing.)
   - `.gitignore` — keeps OS noise and Python caches out of the repo.

### Step 2 — Create a Gmail App Password

The script authenticates to Gmail SMTP with a 16-character **App Password**, not
your normal login password. This avoids OAuth consent screens and app verification
entirely.

1. Turn on **2-Step Verification** for your Gmail:
   <https://myaccount.google.com/security>
2. Create an **App Password**: <https://myaccount.google.com/apppasswords>
   → name it "Settlement Monitor" → Google shows a **16-character password**. Copy it.
   - If App Passwords aren't available, 2-Step Verification is off — or Advanced
     Protection is on, which disables App Passwords.

### Step 3 — Add the two repo secrets

In your repo: **Settings → Secrets and variables → Actions → New repository secret**.
Add both:

| Secret name | Value |
|---|---|
| `GMAIL_ADDRESS` | your Gmail address (used as sender **and** recipient) |
| `GMAIL_APP_PASSWORD` | the 16-char App Password from Step 2 (spaces are ignored) |

The workflow passes these into `monitor.py` as environment variables; they are never
written to the repo.

### Step 4 — Customize your eligibility profile

Open `monitor.py` and edit `CONFIG["profile"]` — the keyword buckets the scorer
matches settlements against. Replace the example entries with things that apply to
*you* (all lowercase). See [Tuning](#tuning) below for the full list of knobs.

> 🔒 **Privacy:** the profile holds **only** company / brand / place names you choose
> to track. **Do not** add SSN, date of birth, bank account numbers, claim numbers,
> or passwords — the script never asks for any of that, and none of it belongs in the
> repo.

### Step 5 — Enable Actions and run it

1. Go to the repo's **Actions** tab and enable workflows if prompted.
2. Confirm the workflow has write permission (it commits `seen.json` back):
   **Settings → Actions → General → Workflow permissions → Read and write
   permissions**. The workflow also declares `permissions: contents: write` itself.
3. Do a first manual run: **Actions → Weekly settlement monitor → Run workflow**.
   Check your inbox for the digest, and confirm the run committed an updated
   `seen.json`.

That's it. From here it runs **automatically every Monday** with no further action.

---

## Running it

- **Automatic:** every **Monday ~8 AM PDT** (`cron: '0 15 * * 1'` in
  [`.github/workflows/monitor.yml`](.github/workflows/monitor.yml)). GitHub cron has
  no DST, so it drifts to 7 AM PST in winter — fine for a weekly digest.
- **On demand:** repo → **Actions** tab → *Weekly settlement monitor* →
  **Run workflow**.

Each run: fetch feeds → parse → score → drop already-seen items → email the digest →
commit the updated `seen.json`.

---

## How it works

All logic is in [`monitor.py`](monitor.py); the workflow just runs it and commits
`seen.json`.

| Function | Role |
|---|---|
| `fetch_sources()` | GETs each RSS feed (failures are skipped, never fatal) |
| `parse_settlements()` | Regex-extracts title / link / date / deadline from feed items |
| `score_eligibility()` | Scores item text against your profile keyword buckets |
| `sniff_deadline()` | Pulls a claim deadline out of the item text if present |
| `load_seen()` / `save_seen()` | Read/write `seen.json` dedup state |
| `run_weekly_digest()` | Orchestrates fetch → parse → score → dedup → bucket |
| `build_html()` / `send_digest_email()` | Builds the digest and sends via Gmail SMTP |

**Email sections:** Strong matches · Possible matches · Upcoming deadlines · New
settlements found. Each item shows the name, why it matched, deadline (if found),
source URL, a confidence score, and a reminder to verify manually.

**Dedup:** a settlement already in `seen.json` is skipped, unless its deadline is
within `deadline_window_days` (default 14), in which case it re-surfaces under
"Upcoming deadlines" so the window isn't missed.

**Sources** live in the `SOURCES` array in `monitor.py` — add or remove RSS feeds
freely. Verify a new feed in a browser (you should see XML) before adding it.

---

## Tuning

Edit `CONFIG` in [`monitor.py`](monitor.py) and push to `main`:

- `CONFIG["profile"]` — the keyword buckets (states, employers, banks, providers,
  retailers, products, apps, cars, schools, health, breaches). Use lowercase names.
  Matching is word-boundary, so a short brand like `jif` won't fire inside `jiffy`.
- `CONFIG["strong_threshold"]` / `["possible_threshold"]` — raise to reduce noise.
- `CONFIG["weights"]` — points each bucket scores per keyword hit.
- `CONFIG["deadline_window_days"]` — how close a deadline must be to re-surface a
  previously-emailed item (default 14).
- `CONFIG["email"]` — digest recipient; defaults to `GMAIL_ADDRESS` if left blank.
- Schedule — edit the `cron` line in `.github/workflows/monitor.yml`.

---

## Repo layout

| Path | Purpose |
|---|---|
| `monitor.py` | The monitor (fetch, score, email). The whole app. |
| `.github/workflows/monitor.yml` | Weekly cron + commits `seen.json` back |
| `seen.json` | Dedup state, updated by the bot each run |
| `.gitignore` | Keeps OS noise and Python caches out of the repo |
| `SETUP_STATUS.md` | Notes on where setup was left off |

> **Note:** This project originally ran inside Google Apps Script, but that path was
> abandoned because authorizing the script kept hitting Google's app-verification
> wall. It now runs as a GitHub Action with `monitor.py`. The old Apps Script files
> (`Code.gs`, `appsscript.json`, `.clasp.json`) have been removed; see git history if
> you ever need them.
</content>
</invoke>
