# Settlement Eligibility Monitor

A **free** weekly monitor that scans public class-action / settlement RSS feeds,
scores them against your personal eligibility profile, and emails you a digest of
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

## Privacy

The eligibility profile (in `monitor.py` → `CONFIG["profile"]`) holds **only**
company / brand / place names you choose to track (states, employers, banks, apps,
retailers, cars, schools, data-breach notices). **Do not** add SSN, full date of
birth, bank account numbers, claim numbers, or passwords. The repo never stores any
of that, and the script never asks for it.

---

## Setup (~3 min)

Already done and live, but for reference / if secrets are ever rotated:

1. Turn on **2-Step Verification** for your Gmail: <https://myaccount.google.com/security>
2. Create a **Google App Password**: <https://myaccount.google.com/apppasswords>
   → name it "Settlement Monitor" → Google shows a **16-character password**.
   (If App Passwords aren't available, 2-Step is off — or Advanced Protection is on,
   which disables App Passwords.)
3. Add two repo secrets at
   <https://github.com/aryakr4/lawsuit/settings/secrets/actions>:
   - `GMAIL_ADDRESS` = your Gmail (sender **and** recipient)
   - `GMAIL_APP_PASSWORD` = the 16-char password (spaces are ignored)

That's it. It runs automatically every Monday.

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

- `CONFIG["profile"]` — the keyword buckets (states, employers, banks, apps,
  retailers, cars, schools, health, breaches). Use lowercase names.
- `CONFIG["strong_threshold"]` / `["possible_threshold"]` — raise to reduce noise.
- `CONFIG["weights"]` — points each bucket scores per keyword hit.
- `CONFIG["deadline_window_days"]` — how close a deadline must be to re-surface a
  previously-emailed item (default 14).
- Schedule — edit the `cron` line in `.github/workflows/monitor.yml`.

---

## Repo layout

| Path | Purpose |
|---|---|
| `monitor.py` | The monitor (fetch, score, email). The whole app. |
| `.github/workflows/monitor.yml` | Weekly cron + commits `seen.json` back |
| `seen.json` | Dedup state, updated by the bot each run |
| `SETUP_STATUS.md` | Where setup was left off (now live) |
| `Code.gs`, `appsscript.json`, `.clasp.json` | **Historical only** — the abandoned Google Apps Script implementation (see note below) |

> **Note:** This project originally ran inside Google Apps Script (`Code.gs`), but
> that path was abandoned because authorizing the script kept hitting Google's
> app-verification wall. It now runs as a GitHub Action with `monitor.py`. The
> `Code.gs` / `appsscript.json` / `.clasp.json` files are kept only as historical
> reference and are not used.
