# Setup status — where I left off

Last updated: 2026-06-19

## ⚡ Architecture changed: Apps Script → GitHub Actions
The Google Apps Script path was abandoned. Authorizing the script kept hitting
Google's app-verification wall ("This app is blocked" → 403 "not an approved
tester") on the personal Gmail, and there was no clean way through it.

The monitor now runs as a **GitHub Action on a weekly cron** (`monitor.py` +
`.github/workflows/monitor.yml`). Same RSS feeds, same eligibility profile, same
scoring and HTML digest — but it emails via **Gmail SMTP with an App Password**,
which needs no OAuth consent screen, no app verification, and no test users.
Dedup state lives in `seen.json`, committed back to the repo each run.

`Code.gs` / `appsscript.json` / `.clasp.json` are kept only as historical
reference. The old `deploy.yml` workflow was deleted.

## ✅ Done
- `monitor.py` written and smoke-tested locally: feeds fetch, 100 unique items
  parse, scoring works (e.g. Meta/TikTok/YouTube social-media settlement = 8/strong),
  HTML + plaintext digest render without error.
- Feeds fixed: `classaction.org` has no working RSS anymore (dropped). Now using
  two live Top Class Actions feeds (main + the lawsuit-settlements category).
- Weekly workflow `.github/workflows/monitor.yml` added (cron `0 15 * * 1` =
  8am PDT / 7am PST Mondays; also runnable on demand via "Run workflow").
- `seen.json` seeded as `{}`.

## ⛔ Blocked here — ONE manual step left (resume here)
The Action needs two repo secrets before it can send email. They are NOT set yet.

### What the user must do (~3 min)
1. Turn on **2-Step Verification** for aryakrish4@gmail.com if it isn't already:
   https://myaccount.google.com/security
2. Create a **Google App Password**:
   https://myaccount.google.com/apppasswords
   → name it "Settlement Monitor" → Google shows a **16-character password**.
   (If the page says App Passwords aren't available, 2-Step Verification is off,
   or Advanced Protection is on — App Passwords are disabled under Advanced
   Protection, which would be the new blocker.)
3. Add two repo secrets at
   https://github.com/aryakr4/lawsuit/settings/secrets/actions :
   - `GMAIL_ADDRESS` = `aryakrish4@gmail.com`
   - `GMAIL_APP_PASSWORD` = the 16-char password (spaces optional, they're ignored)
4. Trigger a test run: repo → **Actions** tab → "Weekly settlement monitor" →
   **Run workflow**. Check inbox for "Weekly settlement eligibility digest" and
   confirm a "update seen settlements" commit appears.

After that it runs automatically every Monday.

## Optional later (profile tuning — same TODOs as before)
- Add VC firm names to `CONFIG["profile"]["employers"]` in `monitor.py`.
- Pick the actual eyewear seller in `retailers` and delete the rest.
- Add a health insurer/pharmacy to `health` if you want those matches.
- Adjust the schedule by editing the `cron` line in `monitor.yml`.
