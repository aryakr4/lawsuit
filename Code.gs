/**
 * Weekly Class-Action / Settlement Eligibility Monitor
 * --------------------------------------------------------------------------
 * Runs inside Google Apps Script on a weekly time-driven trigger. It fetches
 * public class-action / settlement RSS feeds, matches each item against your
 * personal eligibility profile, de-duplicates against a Google Sheet, and emails
 * you a digest of possible matches.
 *
 * IMPORTANT — this tool only suggests *possible eligibility*. It is NOT legal
 * advice and it cannot confirm you qualify. Always verify on the official claim
 * site before acting.
 *
 * PRIVACY — do not put sensitive data in the profile below. No SSN, no full date
 * of birth, no bank account numbers, no claim numbers, no passwords. The profile
 * holds only company / brand / place names that you choose to track.
 *
 * ==========================================================================
 * HOW TO DEPLOY (manual, ~5 minutes)
 * ==========================================================================
 *   1. Go to https://script.google.com and create a New project.
 *   2. Delete the starter code and paste the entire contents of this file.
 *   3. Edit CONFIG.email and fill in CONFIG.profile with YOUR values
 *      (the values shipped below are EXAMPLES — replace them).
 *   4. Run setupWeeklyTrigger() once. Google will prompt you to authorize
 *      permissions (UrlFetch, Gmail, Sheets, Triggers) — approve them.
 *   5. Run testRun() to send yourself a one-off digest and confirm it works.
 *   That's it. From then on it emails you once a week automatically.
 *
 * HOW TO DEPLOY (auto, via GitHub Actions — optional)
 *   See README.md. Push to the `main` branch and a GitHub Action runs
 *   `clasp push` to deploy this file. You still run setupWeeklyTrigger() /
 *   testRun() once from the Apps Script editor.
 * ==========================================================================
 */

/* =========================================================================
 * CONFIG
 * ========================================================================= */
const CONFIG = {
  // Where the digest is sent. Leave "" to use the account running the script.
  email: '',

  // Spreadsheet tab used to remember what we've already emailed about.
  sheetName: 'Seen',

  // Scoring thresholds (tune to taste).
  strongThreshold: 6,    // total score >= this  -> "Strong match"
  possibleThreshold: 3,  // total score >= this  -> "Possible match"

  // Points added per keyword hit, by profile bucket. Higher = more important.
  weights: {
    states: 1,
    employers: 4,
    banks: 3,
    providers: 2,
    retailers: 2,
    apps: 2,
    cars: 3,
    health: 3,
    schools: 3,
    breaches: 4,
  },

  // A settlement already in the "Seen" sheet is normally skipped. But if its
  // deadline is within this many days, we re-surface it under "Upcoming
  // deadlines" so you don't miss the window.
  deadlineWindowDays: 14,

  // Network timeout safety for each feed fetch (ms).
  fetchTimeoutMs: 20000,

  // ---------------------------------------------------------------------
  // YOUR ELIGIBILITY PROFILE  --  *** EXAMPLE VALUES, REPLACE THESE ***
  // Only put names of states/companies/brands you have actually used or are
  // associated with. More accurate buckets = fewer false positives.
  // Keep entries lowercase; matching is case-insensitive anyway.
  // ---------------------------------------------------------------------
  profile: {
    states:    ['california', 'new york'],                 // states you lived in
    employers: ['acme corp', 'globex'],                    // current/past employers
    banks:     ['wells fargo', 'chase', 'venmo', 'paypal'],// banks / financial apps
    providers: ['verizon', 'comcast', 'at&t', 'xfinity'],  // phone / internet
    retailers: ['target', 'walmart', 'amazon'],            // retailers
    apps:      ['facebook', 'instagram', 'tiktok', 'google'], // apps / websites used
    cars:      ['honda', 'toyota'],                        // cars owned
    health:    ['kaiser', 'blue cross', 'cvs'],            // health insurance/providers
    schools:   ['ucla', 'state university'],               // schools / universities
    breaches:  ['equifax', 'experian'],                    // data-breach notices you got
  },
};

/* =========================================================================
 * SOURCES  --  public RSS / Atom feeds (free, no API key).
 * Add or remove freely. If a feed ever stops working it is skipped, not fatal.
 * Tip: most WordPress-based legal-news sites expose feeds at /feed/.
 * Verify a feed in a browser before adding it (you should see XML).
 * ========================================================================= */
const SOURCES = [
  { name: 'Top Class Actions',            url: 'https://topclassactions.com/feed/' },
  { name: 'Top Class Actions — Settlements', url: 'https://topclassactions.com/lawsuit-settlements/feed/' },
  { name: 'ClassAction.org News',         url: 'https://www.classaction.org/news/feed' },
  // Add your own, e.g.:
  // { name: 'Some Source', url: 'https://example.com/feed/' },
];

/* =========================================================================
 * fetchSources()
 * Fetch each feed's raw XML. Returns [{ name, url, xml }]. Failures are logged
 * and skipped so one dead feed never breaks the run.
 * ========================================================================= */
function fetchSources() {
  const results = [];
  SOURCES.forEach(function (src) {
    try {
      const resp = UrlFetchApp.fetch(src.url, {
        muteHttpExceptions: true,
        followRedirects: true,
        validateHttpsCertificates: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (SettlementMonitor AppsScript)' },
      });
      const code = resp.getResponseCode();
      if (code >= 200 && code < 300) {
        results.push({ name: src.name, url: src.url, xml: resp.getContentText() });
      } else {
        Logger.log('Source %s returned HTTP %s', src.name, code);
      }
    } catch (err) {
      Logger.log('Source %s failed: %s', src.name, err);
    }
  });
  return results;
}

/* =========================================================================
 * parseSettlements(sources)
 * Regex-parse RSS/Atom <item>/<entry> blocks into objects:
 *   { title, url, published, deadline, text, source }
 * Uses simple regex only (no XML library needed for these well-formed feeds).
 * ========================================================================= */
function parseSettlements(sources) {
  const items = [];
  sources.forEach(function (src) {
    // Split on RSS <item> or Atom <entry>.
    const blocks = src.xml.split(/<item\b|<entry\b/i).slice(1);
    blocks.forEach(function (block) {
      const title = decodeEntities(stripCdata(firstMatch(block, /<title[^>]*>([\s\S]*?)<\/title>/i)));
      if (!title) return;

      // Link: RSS uses <link>...</link>; Atom uses <link href="...">.
      var url = stripCdata(firstMatch(block, /<link[^>]*>([\s\S]*?)<\/link>/i));
      if (!url) url = firstMatch(block, /<link[^>]*href=["']([^"']+)["']/i);

      const published = stripCdata(
        firstMatch(block, /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ||
        firstMatch(block, /<updated[^>]*>([\s\S]*?)<\/updated>/i) ||
        firstMatch(block, /<published[^>]*>([\s\S]*?)<\/published>/i)
      );

      const description = decodeEntities(stripCdata(
        firstMatch(block, /<description[^>]*>([\s\S]*?)<\/description>/i) ||
        firstMatch(block, /<summary[^>]*>([\s\S]*?)<\/summary>/i) ||
        firstMatch(block, /<content[^>]*>([\s\S]*?)<\/content>/i)
      ));

      const text = (title + ' ' + description);
      items.push({
        title: title.trim(),
        url: (url || '').trim(),
        published: published.trim(),
        deadline: sniffDeadline(text),
        text: stripHtml(text),
        source: src.name,
      });
    });
  });
  return items;
}

/* =========================================================================
 * scoreEligibility(item)
 * Compare item text against the profile buckets. Returns:
 *   { score, tier, reasons: [{ bucket, keyword }] }
 * tier is 'strong' | 'possible' | 'none'.
 * ========================================================================= */
function scoreEligibility(item) {
  const haystack = (item.title + ' ' + item.text).toLowerCase();
  var score = 0;
  const reasons = [];

  Object.keys(CONFIG.profile).forEach(function (bucket) {
    const weight = CONFIG.weights[bucket] || 1;
    CONFIG.profile[bucket].forEach(function (keyword) {
      const kw = String(keyword).toLowerCase().trim();
      if (kw && haystack.indexOf(kw) !== -1) {
        score += weight;
        reasons.push({ bucket: bucket, keyword: kw });
      }
    });
  });

  var tier = 'none';
  if (score >= CONFIG.strongThreshold) tier = 'strong';
  else if (score >= CONFIG.possibleThreshold) tier = 'possible';

  return { score: score, tier: tier, reasons: reasons };
}

/* =========================================================================
 * runWeeklyDigest()
 * Orchestrator: fetch -> parse -> score -> dedup -> email -> record.
 * ========================================================================= */
function runWeeklyDigest() {
  const sheet = getSeenSheet_();
  const seen = loadSeen_(sheet);               // map url -> row info
  const now = new Date();

  const raw = parseSettlements(fetchSources());

  const strong = [];
  const possible = [];
  const upcoming = [];     // already-seen but deadline within window
  const newFound = [];     // brand new (any tier, for the "New" section)
  const toRecord = [];     // new rows to append to the sheet

  raw.forEach(function (item) {
    if (!item.url) return;
    const evalResult = scoreEligibility(item);
    const isNew = !seen[item.url];
    const deadlineDate = parseDate_(item.deadline);
    const daysLeft = deadlineDate ? Math.ceil((deadlineDate - now) / 86400000) : null;
    const deadlineSoon = daysLeft !== null && daysLeft >= 0 && daysLeft <= CONFIG.deadlineWindowDays;

    const enriched = {
      item: item,
      eval: evalResult,
      daysLeft: daysLeft,
    };

    if (isNew) {
      // Record every newly-seen item so we don't re-evaluate forever.
      toRecord.push({
        title: item.title,
        url: item.url,
        deadline: item.deadline || '',
        firstSeen: Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        score: evalResult.score,
      });

      newFound.push(enriched);
      if (evalResult.tier === 'strong') strong.push(enriched);
      else if (evalResult.tier === 'possible') possible.push(enriched);
    } else if (deadlineSoon && evalResult.tier !== 'none') {
      // Previously emailed, but deadline is closing in -> remind once more.
      upcoming.push(enriched);
    }
  });

  // Sort high score first.
  const byScore = function (a, b) { return b.eval.score - a.eval.score; };
  strong.sort(byScore); possible.sort(byScore); newFound.sort(byScore);
  upcoming.sort(function (a, b) { return (a.daysLeft || 999) - (b.daysLeft || 999); });

  appendSeen_(sheet, toRecord);

  const hasAnything = strong.length || possible.length || upcoming.length || newFound.length;
  if (hasAnything) {
    sendDigestEmail({ strong: strong, possible: possible, upcoming: upcoming, newFound: newFound });
  } else {
    Logger.log('Nothing to report this week.');
  }
}

/* =========================================================================
 * sendDigestEmail(buckets)
 * Build and send the HTML digest.
 * ========================================================================= */
function sendDigestEmail(buckets) {
  const to = CONFIG.email || Session.getEffectiveUser().getEmail();
  const subject = 'Weekly settlement eligibility digest';

  var html = '';
  html += '<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;color:#222">';
  html += '<h2 style="margin-bottom:4px">Weekly settlement eligibility digest</h2>';
  html += '<p style="color:#666;margin-top:0">Possible matches against your profile. ' +
          'This is <b>not legal advice</b> and does not confirm you qualify.</p>';

  html += renderSection_('✅ Strong matches', buckets.strong);
  html += renderSection_('🟡 Possible matches', buckets.possible);
  html += renderSection_('⏰ Upcoming deadlines', buckets.upcoming);
  html += renderSection_('🆕 New settlements found', buckets.newFound);

  // Scam-warning + disclaimer footer (always present).
  html += '<hr style="margin-top:24px">';
  html += '<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:6px;padding:12px;font-size:13px">';
  html += '<b>⚠️ Stay safe from scams</b><ul style="margin:8px 0 0 18px;padding:0">';
  html += '<li><b>Never pay to claim a settlement.</b> Legitimate claims are free.</li>';
  html += '<li><b>Verify the official claim site</b> before entering any information. Find it via the court / administrator, not via an email link.</li>';
  html += '<li><b>Watch for phishing.</b> Be suspicious of urgency, unexpected texts/emails, and requests for SSN, bank, or password.</li>';
  html += '</ul></div>';
  html += '<p style="font-size:12px;color:#888;margin-top:12px">This automated monitor suggests <i>possible</i> eligibility only. ' +
          'Always read the official notice and verify your eligibility manually before filing a claim. It is not a substitute for legal advice.</p>';
  html += '</div>';

  GmailApp.sendEmail(to, subject, htmlToText_(html), { htmlBody: html, name: 'Settlement Monitor' });
  Logger.log('Digest sent to %s', to);
}

/* -------------------------------------------------------------------------
 * Email section renderer
 * ----------------------------------------------------------------------- */
function renderSection_(heading, entries) {
  var html = '<h3 style="margin-bottom:6px;margin-top:22px">' + heading +
             ' <span style="color:#999;font-weight:normal">(' + entries.length + ')</span></h3>';
  if (!entries.length) {
    return html + '<p style="color:#999;margin-top:0">None this week.</p>';
  }
  entries.forEach(function (e) {
    const it = e.item;
    const why = e.eval.reasons.map(function (r) {
      return r.keyword + ' <span style="color:#999">(' + r.bucket + ')</span>';
    }).join(', ') || '—';

    var deadlineLine = '';
    if (it.deadline) {
      var soon = e.daysLeft !== null && e.daysLeft >= 0 && e.daysLeft <= CONFIG.deadlineWindowDays;
      deadlineLine = '<div><b>Deadline:</b> ' + escapeHtml_(it.deadline) +
        (e.daysLeft !== null && e.daysLeft >= 0 ? ' (' + e.daysLeft + ' days left)' : '') +
        (soon ? ' <span style="color:#c62828;font-weight:bold">⏰ closing soon</span>' : '') + '</div>';
    }

    html += '<div style="border:1px solid #e0e0e0;border-radius:8px;padding:12px;margin:8px 0">';
    html += '<div style="font-size:15px;font-weight:bold;margin-bottom:4px">' + escapeHtml_(it.title) + '</div>';
    html += '<div><b>Confidence score:</b> ' + e.eval.score + ' (' + e.eval.tier + ')</div>';
    html += '<div><b>Why it matched:</b> ' + why + '</div>';
    html += deadlineLine;
    html += '<div><b>Source:</b> ' + escapeHtml_(it.source) + '</div>';
    if (it.url) {
      html += '<div><a href="' + escapeHtml_(it.url) + '">Open settlement / source page →</a></div>';
    }
    html += '<div style="font-size:12px;color:#888;margin-top:6px">⚠️ Verify eligibility manually on the official claim site before filing.</div>';
    html += '</div>';
  });
  return html;
}

/* =========================================================================
 * setupWeeklyTrigger()
 * Create (idempotently) a weekly time-driven trigger for runWeeklyDigest().
 * Run this ONCE from the editor. Re-running replaces the old trigger.
 * ========================================================================= */
function setupWeeklyTrigger() {
  // Remove existing triggers for this function to avoid duplicates.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runWeeklyDigest') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('runWeeklyDigest')
    .timeBased()
    .everyWeeks(1)
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)               // ~8am in the script's timezone
    .create();

  // Make sure the Seen sheet exists too.
  getSeenSheet_();
  Logger.log('Weekly trigger installed (Mondays ~8am). Seen sheet ready.');
}

/* =========================================================================
 * testRun()
 * Run a digest immediately (uses real sources & sheet) so you can confirm
 * everything works and see a sample email. Safe to run repeatedly.
 * ========================================================================= */
function testRun() {
  Logger.log('Running test digest...');
  runWeeklyDigest();
  Logger.log('Test digest complete. Check your inbox (%s).',
    CONFIG.email || Session.getEffectiveUser().getEmail());
}

/* =========================================================================
 * Google Sheet helpers (the "Seen" dedup store)
 * ========================================================================= */
function getSeenSheet_() {
  // Use the bound spreadsheet if there is one; otherwise create/find a
  // standalone spreadsheet stored in Drive under a known name.
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    const fileName = 'Settlement Monitor — Seen';
    const files = DriveApp.getFilesByName(fileName);
    if (files.hasNext()) {
      ss = SpreadsheetApp.open(files.next());
    } else {
      ss = SpreadsheetApp.create(fileName);
    }
  }
  var sheet = ss.getSheetByName(CONFIG.sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.sheetName);
    sheet.appendRow(['Title', 'URL', 'Deadline', 'FirstSeen', 'Score']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function loadSeen_(sheet) {
  const map = {};
  const last = sheet.getLastRow();
  if (last < 2) return map;
  const values = sheet.getRange(2, 1, last - 1, 5).getValues();
  values.forEach(function (row) {
    const url = String(row[1] || '').trim();
    if (url) map[url] = { title: row[0], deadline: row[2], firstSeen: row[3], score: row[4] };
  });
  return map;
}

function appendSeen_(sheet, rows) {
  if (!rows || !rows.length) return;
  const out = rows.map(function (r) {
    return [r.title, r.url, r.deadline, r.firstSeen, r.score];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, out.length, 5).setValues(out);
}

/* =========================================================================
 * Small parsing / formatting utilities
 * ========================================================================= */
function firstMatch(text, re) {
  const m = text.match(re);
  return m ? m[1] : '';
}

function stripCdata(s) {
  return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#8217;/g, '’')
    .replace(/&nbsp;/g, ' ');
}

function escapeHtml_(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlToText_(html) {
  return stripHtml(html.replace(/<\/(div|p|li|h2|h3|tr)>/gi, '\n'));
}

/**
 * sniffDeadline(text)
 * Look for a claim/filing deadline date in free text. Returns a human-readable
 * date string ('' if none found). Best-effort only — verify on the official site.
 */
function sniffDeadline(text) {
  if (!text) return '';
  const t = stripHtml(decodeEntities(text));
  // Phrases that usually precede a deadline date.
  const cue = /(?:deadline|claim by|file by|must (?:be )?(?:filed|submitted) by|claims? must be|exclude|opt[- ]?out)[^.]{0,40}?/i;
  // Match "Month DD, YYYY" or "MM/DD/YYYY".
  const dateRe = /([A-Z][a-z]+ \d{1,2},? \d{4})|(\d{1,2}\/\d{1,2}\/\d{2,4})/;

  // Prefer a date that appears right after a deadline cue.
  const cued = t.match(new RegExp(cue.source + '(' + dateRe.source + ')', 'i'));
  if (cued) {
    const d = cued[0].match(dateRe);
    if (d) return d[0];
  }
  // Otherwise fall back to the first date in the text.
  const any = t.match(dateRe);
  return any ? any[0] : '';
}

/**
 * parseDate_(s) -> Date | null  (tolerant of the formats sniffDeadline returns)
 */
function parseDate_(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
