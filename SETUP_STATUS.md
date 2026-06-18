# Setup status — where I left off

Last updated: 2026-06-18

## ✅ Done
- Apps Script project created and code deployed to it.
  - Editor: https://script.google.com/d/1MHKdryljeSqSJ0KEIjXnBz7-iex-YWHiL2YWmhBMMGfmu5ooyOFsP-iN/edit
  - Script ID: `1MHKdryljeSqSJ0KEIjXnBz7-iex-YWHiL2YWmhBMMGfmu5ooyOFsP-iN`
- GitHub repo wired up; auto-deploy works.
  - GitHub Action runs `clasp push` on every push to `main` (last run: success).
  - Repo secret `CLASPRC_JSON` is set.
  - `.clasp.json` has the real Script ID.
- Profile personalized (Eugene/Vancouver, U of Oregon, Westview HS, Subaru/Honda,
  Chase/Coinbase/Robinhood, AT&T, Fred Meyer/Market of Choice/Safeway/Amazon, etc.).
- Email switched to `MailApp` + minimal non-restricted OAuth scopes.

## ⛔ Blocked here — resume at this step
Authorizing the script fails with **"This app is blocked"** on aryakrish4@gmail.com.
Cause: personal Gmail + the script's default Cloud project has no configured OAuth
consent screen, so Google blocks the unverified app.

### Fix (one-time, ~5 min in console.cloud.google.com, signed in as aryakrish4@gmail.com)
1. Create a Cloud project (e.g. "Settlement Monitor").
2. APIs & Services → OAuth consent screen → Audience **External**, fill app name +
   support email, **Create**. Leave publishing status = **Testing** (don't publish).
3. **Add yourself as a Test user** (`aryakrish4@gmail.com`). ← the key step.
4. APIs & Services → Library → enable **Apps Script API**.
5. Copy the project **NUMBER** (digits, not the ID).
6. Apps Script editor → Project Settings (⚙️) → Google Cloud Platform (GCP) Project
   → Change project → paste the project number → Set project.
7. Editor → run `setupWeeklyTrigger` → "Google hasn't verified this app" →
   Advanced → Go to (unsafe) → Allow.
8. Run `testRun` → check inbox for "Weekly settlement eligibility digest".

After that, it emails automatically every Monday ~8am Pacific.

## Optional later
- Add VC firm names to `CONFIG.profile.employers`.
- Pick the actual eyewear seller in `CONFIG.profile.retailers` and delete the rest.
- Add a health insurer/pharmacy to `CONFIG.profile.health` if you want those matches.
- Adjust schedule by editing `setupWeeklyTrigger()` and re-running it.
