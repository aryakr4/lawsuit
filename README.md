# Settlement Eligibility Monitor

A **free, server-less** weekly monitor that scans public class-action / settlement
RSS feeds, matches them against your personal eligibility profile, and emails you a
digest of *possible* matches.

- Runs entirely inside **Google Apps Script** on a weekly time-driven trigger.
- Emails via **GmailApp** — no server, no database, no paid API, no always-on machine.
- Remembers what it already told you in a Google Sheet tab named **`Seen`**, and
  re-surfaces an item only if its deadline is within 14 days.
- **GitHub** is the source of truth; a GitHub Action auto-deploys `Code.gs` via
  [`clasp`](https://github.com/google/clasp) on every push to `main`.

> ⚠️ **This is not legal advice.** It suggests *possible* eligibility only. Always
> verify on the official claim site before filing. **Never pay to claim a
> settlement**, confirm the official administrator, and watch for phishing.

---

## Privacy

The eligibility profile holds **only** company / brand / place names you choose to
track (states, employers, banks, retailers, etc.). **Do not** add SSN, full date of
birth, bank account numbers, claim numbers, or passwords. The repo never stores any
of that, and the script never asks for it.

---

## Quick start (manual — no GitHub needed, ~5 min)

1. Go to <https://script.google.com> → **New project**.
2. Delete the starter code and paste the entire contents of [`Code.gs`](Code.gs).
3. Edit `CONFIG.email` and replace the **example** values in `CONFIG.profile` with
   your own (states lived in, employers, banks/apps, providers, retailers, cars,
   health providers, schools, data-breach notices).
4. Run **`setupWeeklyTrigger()`** once → approve the permission prompts
   (UrlFetch, Gmail, Sheets, Drive, Triggers).
5. Run **`testRun()`** → check your inbox for a sample digest.

Done. It now emails you every Monday morning automatically.

---

## Optional: auto-deploy from this GitHub repo via `clasp`

This lets you edit `Code.gs` here and have it pushed to Apps Script on every commit.

### One-time setup

1. **Create the Apps Script project** (do the manual quick-start above once so a
   project exists). In the editor: **Project Settings → copy the Script ID**.
2. **Enable the Apps Script API** for your account at
   <https://script.google.com/home/usersettings> (toggle it **on**).
3. **Install clasp and log in locally:**
   ```bash
   npm install -g @google/clasp@2.4.2
   clasp login          # opens a browser; authorize
   ```
   This writes credentials to `~/.clasprc.json`.
4. **Add the GitHub secret** so the Action can authenticate:
   - Copy the full contents of `~/.clasprc.json`
     (`cat ~/.clasprc.json` — macOS/Linux).
   - In GitHub: **repo → Settings → Secrets and variables → Actions →
     New repository secret**.
   - Name: `CLASPRC_JSON`  •  Value: paste the file contents.
5. **Set your Script ID:** edit [`.clasp.json`](.clasp.json) and replace
   `PASTE_YOUR_SCRIPT_ID_HERE` with the Script ID from step 1. Commit it
   (the Script ID is not a secret).

### Deploy

Push to `main` (or run the workflow manually from the **Actions** tab). The
[deploy workflow](.github/workflows/deploy.yml) runs `clasp push` and updates your
Apps Script project.

> The GitHub Action **only deploys code**. The monitor itself runs inside Apps
> Script on its weekly trigger. After the first deploy, run `setupWeeklyTrigger()`
> and `testRun()` once from the Apps Script editor (per the quick start).

> **Heads-up:** `clasp` refresh tokens can expire. If a deploy fails with an auth
> error, run `clasp login` again locally and update the `CLASPRC_JSON` secret.

---

## How it works

| Function | Role |
|---|---|
| `fetchSources()` | GETs each RSS feed (failures are skipped, never fatal) |
| `parseSettlements()` | Regex-extracts title / link / date / deadline from feed items |
| `scoreEligibility()` | Scores item text against your profile keyword buckets |
| `runWeeklyDigest()` | Orchestrates fetch → parse → score → dedup → email → record |
| `sendDigestEmail()` | Builds the 4-section HTML digest + scam-warning footer |
| `setupWeeklyTrigger()` | Installs the weekly time-driven trigger (run once) |
| `testRun()` | Runs a digest immediately for testing |

**Email sections:** Strong matches · Possible matches · Upcoming deadlines · New
settlements found. Each item shows the name, why it matched, deadline (if found),
source URL, a confidence score, and a reminder to verify manually.

**Sources** live in the `SOURCES` array in `Code.gs` — add or remove RSS feeds
freely. Verify a new feed in a browser (you should see XML) before adding it.

---

## Tuning

- `CONFIG.strongThreshold` / `CONFIG.possibleThreshold` — raise to reduce noise.
- `CONFIG.weights` — how many points each profile bucket scores per keyword hit.
- `CONFIG.deadlineWindowDays` — how close a deadline must be to re-surface a
  previously-emailed item (default 14).
