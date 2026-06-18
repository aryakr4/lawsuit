# Settlement Eligibility Monitor — Design

Date: 2026-06-18

## Goal

A free, server-less weekly monitor that searches public class-action / settlement
RSS sources, matches them against a personal eligibility profile, and emails a
digest of likely/possible matches. Runs inside Google Apps Script; GitHub is the
source of truth and auto-deploys via `clasp`.

## Hard constraints

- Free to run. No server, no paid API, no database, no always-on computer.
- Scheduling via Google Apps Script time-driven triggers.
- Email via `MailApp`/`GmailApp`.
- No sensitive data collected (no SSN, full DOB, bank account #, claim #, passwords).
  The profile holds only company/brand/place names the user chooses.
- Output is "possible eligibility," not legal advice.
- Every email includes scam warnings (never pay to claim, verify official claim
  site, watch for phishing).
- Simple regex/XML parsing only. No paid AI.

## Architecture

- **Runtime:** Google Apps Script. Weekly time-driven trigger → `runWeeklyDigest()`.
- **Storage:** Bound Google Sheet, tab `Seen` with columns
  `Title | URL | Deadline | FirstSeen | Score`. Serves as the dedup database.
- **Email:** `GmailApp.sendEmail()` HTML digest to `CONFIG.email`.
- **CI/CD:** Repo `aryakr4/lawsuit`. GitHub Action runs `clasp push` on commits to
  `main`. Auth via `CLASPRC_JSON` secret (contents of `~/.clasprc.json` after a
  one-time local `clasp login`).

## Data flow

`fetchSources()` (UrlFetchApp GET each RSS URL, tolerant of failures)
→ `parseSettlements()` (regex extract `<item>` title/link/pubDate + sniff a deadline
date from title/description)
→ `scoreEligibility()` (match item text against profile keyword buckets)
→ dedup vs `Seen` tab
→ `sendDigestEmail()` (4-section HTML)
→ `runWeeklyDigest()` orchestrates, appends new rows to `Seen`.

## Scoring

Profile buckets: states, employers, banks, providers (phone/internet),
retailers, apps, cars, health, schools, breaches. Each keyword hit adds points
(weights in CONFIG). Tiers:

- **Strong** ≥ `CONFIG.strongThreshold`
- **Possible** ≥ `CONFIG.possibleThreshold`
- below → ignored

"Why it matched" = list of matched keywords + buckets.

## Dedup rule

Skip items already present in `Seen` — **unless** the parsed deadline is within
`CONFIG.deadlineWindowDays` (14), in which case the item re-surfaces under
"Upcoming deadlines."

## Email format

Subject: `Weekly settlement eligibility digest`. Sections:
1. Strong matches
2. Possible matches
3. Upcoming deadlines
4. New settlements found

Each item: name, why matched, deadline (if any), official/source URL, confidence
score, "verify eligibility manually" reminder. Footer: not-legal-advice + scam
warnings.

## Repo files

```
Code.gs                        # CONFIG, profile template, SOURCES, all functions
appsscript.json                # manifest (scopes, timezone, V8)
.clasp.json                    # scriptId (user pastes theirs; safe to commit)
.github/workflows/deploy.yml   # clasp push on commit to main
README.md                      # deploy instructions
.gitignore                     # ignores .clasprc.json
```

## Functions in Code.gs

`CONFIG`, `CONFIG.profile`, `SOURCES`, `fetchSources()`, `parseSettlements()`,
`scoreEligibility()`, `sendDigestEmail()`, `runWeeklyDigest()`,
`setupWeeklyTrigger()`, `testRun()`.

## Out of scope (YAGNI)

HTML scraping, AI/paid APIs, collecting sensitive data, auto-claiming settlements.
