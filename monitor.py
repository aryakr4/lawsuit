#!/usr/bin/env python3
"""
Weekly Class-Action / Settlement Eligibility Monitor
--------------------------------------------------------------------------
Runs in GitHub Actions on a weekly cron. Fetches public class-action /
settlement RSS feeds, matches each item against a personal eligibility
profile, de-duplicates against seen.json (committed back to the repo), and
emails a digest via Gmail SMTP using an App Password.

This replaces the old Google Apps Script version (Code.gs). It needs NO
Google OAuth consent screen, no app verification, and no "test users" —
the App Password authenticates SMTP directly.

IMPORTANT — this tool only suggests *possible eligibility*. It is NOT legal
advice and cannot confirm you qualify. Always verify on the official claim
site before acting.

PRIVACY — the profile holds only company / brand / place names you choose to
track. No SSN, DOB, account numbers, claim numbers, or passwords.

ENV / SECRETS required (set as GitHub repo secrets):
  GMAIL_ADDRESS       - the Gmail you send from / to (e.g. aryakrish4@gmail.com)
  GMAIL_APP_PASSWORD  - a 16-char Google App Password (NOT your login password)
"""

import os
import re
import json
import sys
import smtplib
import urllib.request
import urllib.error
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

# =========================================================================
# CONFIG
# =========================================================================
CONFIG = {
    # Digest recipient. Defaults to GMAIL_ADDRESS env if left blank.
    "email": "aryakrish4@gmail.com",

    # File used to remember what we've already emailed about.
    "seen_file": "seen.json",

    # Scoring thresholds (tune to taste).
    "strong_threshold": 6,
    "possible_threshold": 3,

    # Points per keyword hit, by profile bucket. Higher = more important.
    "weights": {
        "states": 1,
        "employers": 4,
        "banks": 3,
        "providers": 2,
        "retailers": 2,
        "products": 2,
        "apps": 2,
        "cars": 3,
        "health": 3,
        "schools": 3,
        "breaches": 4,
    },

    # A settlement already in seen.json is normally skipped, but if its
    # deadline is within this many days we re-surface it under "Upcoming
    # deadlines" so the window isn't missed.
    "deadline_window_days": 14,

    # Per-feed network timeout (seconds).
    "fetch_timeout_s": 20,

    # ---------------------------------------------------------------------
    # ELIGIBILITY PROFILE  (ported verbatim from Code.gs)
    # ---------------------------------------------------------------------
    "profile": {
        "states": ["oregon", "washington"],           # Eugene OR; Vancouver WA
        "employers": [],                               # add VC firm names (lowercase)
        "schools": ["university of oregon", "westview high school"],
        "cars": ["subaru", "honda"],

        "banks": ["chase", "coinbase", "robinhood"],
        "providers": ["at&t", "att"],
        "retailers": [
            "fred meyer", "market of choice", "safeway", "amazon",
            # Eyewear — keep the seller you actually bought from, delete the rest:
            "warby parker", "eyebuydirect", "zenni", "lenscrafters",
            "glasses.com", "1-800 contacts", "visionworks", "luxottica",
            "eyeglasses", "eyewear",
        ],
        # Specific products/brands you own or buy — for defect, false-advertising,
        # and mislabeling class actions that name a brand + product. Brand-specific
        # terms only (lowercase); avoid generic category words to keep noise down.
        "products": [
            "darigold",        # milk / dairy
            "shea moisture",   # conditioner / hair care
            "jif",             # peanut butter (brand is "Jif")
            "macbook",         # Apple MacBook (M4)
            "fujifilm",        # camera
            "canon",           # camera
            "kodiak",          # Kodiak Cakes protein products
        ],
        "apps": [
            "tiktok", "instagram", "snapchat", "youtube", "telegram", "duo mobile",
            "alltrails", "outlook", "chatgpt", "openai", "linkedin", "granola",
            "uber", "parking kitty", "blackmagic",
        ],
        "health": [],                                  # add insurer/pharmacy if wanted
        "breaches": [
            "chase", "at&t", "coinbase",
            "equifax", "experian", "transunion", "t-mobile", "verizon",
            "capital one", "anthem", "marriott", "yahoo", "facebook", "meta",
            "moveit", "change healthcare", "uber", "plaid", "23andme",
            "comcast", "lastpass", "progressive", "public storage", "usaa",
        ],
    },
}

# =========================================================================
# SOURCES — public RSS / Atom feeds (free, no API key).
# =========================================================================
SOURCES = [
    {"name": "Top Class Actions", "url": "https://topclassactions.com/feed/"},
    {"name": "Top Class Actions — Settlements",
     "url": "https://topclassactions.com/category/lawsuit-settlements/feed/"},
]


# =========================================================================
# Fetch
# =========================================================================
def fetch_sources():
    """Fetch each feed's raw XML. Failures are logged and skipped."""
    results = []
    for src in SOURCES:
        try:
            req = urllib.request.Request(
                src["url"],
                headers={"User-Agent": "Mozilla/5.0 (SettlementMonitor GitHubActions)"},
            )
            with urllib.request.urlopen(req, timeout=CONFIG["fetch_timeout_s"]) as resp:
                if 200 <= resp.status < 300:
                    xml = resp.read().decode("utf-8", errors="replace")
                    results.append({"name": src["name"], "url": src["url"], "xml": xml})
                else:
                    print(f"Source {src['name']} returned HTTP {resp.status}", file=sys.stderr)
        except Exception as err:  # noqa: BLE001 - one dead feed must not break the run
            print(f"Source {src['name']} failed: {err}", file=sys.stderr)
    return results


# =========================================================================
# Parse
# =========================================================================
def first_match(text, pattern):
    m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
    return m.group(1) if m else ""


def strip_cdata(s):
    return re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", s or "", flags=re.DOTALL)


def strip_html(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", s).strip()


def decode_entities(s):
    s = s or ""
    repl = {
        "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
        "&apos;": "'", "&#39;": "'", "&#039;": "'",
        "&#8217;": "’", "&nbsp;": " ",
    }
    for k, v in repl.items():
        s = s.replace(k, v)
    return s


def parse_settlements(sources):
    """Regex-parse RSS <item> / Atom <entry> blocks into dicts."""
    items = []
    for src in sources:
        blocks = re.split(r"<item\b|<entry\b", src["xml"], flags=re.IGNORECASE)[1:]
        for block in blocks:
            title = decode_entities(strip_cdata(
                first_match(block, r"<title[^>]*>(.*?)</title>")))
            if not title:
                continue

            url = strip_cdata(first_match(block, r"<link[^>]*>(.*?)</link>"))
            if not url:
                url = first_match(block, r"<link[^>]*href=[\"']([^\"']+)[\"']")

            published = strip_cdata(
                first_match(block, r"<pubDate[^>]*>(.*?)</pubDate>")
                or first_match(block, r"<updated[^>]*>(.*?)</updated>")
                or first_match(block, r"<published[^>]*>(.*?)</published>"))

            description = decode_entities(strip_cdata(
                first_match(block, r"<description[^>]*>(.*?)</description>")
                or first_match(block, r"<summary[^>]*>(.*?)</summary>")
                or first_match(block, r"<content[^>]*>(.*?)</content>")))

            text = title + " " + description
            items.append({
                "title": title.strip(),
                "url": (url or "").strip(),
                "published": published.strip(),
                "deadline": sniff_deadline(text),
                "text": strip_html(text),
                "source": src["name"],
            })
    return items


# =========================================================================
# Score
# =========================================================================
def keyword_hit(haystack, keyword):
    """Word-boundary match so 'att' won't fire inside 'battery'. Args lowercase."""
    esc = re.escape(keyword)
    return re.search(r"(^|[^a-z0-9])" + esc + r"([^a-z0-9]|$)", haystack) is not None


def score_eligibility(item):
    haystack = (item["title"] + " " + item["text"]).lower()
    score = 0
    reasons = []
    for bucket, keywords in CONFIG["profile"].items():
        weight = CONFIG["weights"].get(bucket, 1)
        for keyword in keywords:
            kw = str(keyword).lower().strip()
            if kw and keyword_hit(haystack, kw):
                score += weight
                reasons.append({"bucket": bucket, "keyword": kw})
    tier = "none"
    if score >= CONFIG["strong_threshold"]:
        tier = "strong"
    elif score >= CONFIG["possible_threshold"]:
        tier = "possible"
    return {"score": score, "tier": tier, "reasons": reasons}


# =========================================================================
# Deadline parsing
# =========================================================================
DATE_RE = r"([A-Z][a-z]+ \d{1,2},? \d{4})|(\d{1,2}/\d{1,2}/\d{2,4})"


def sniff_deadline(text):
    if not text:
        return ""
    t = strip_html(decode_entities(text))
    cue = (r"(?:deadline|claim by|file by|must (?:be )?(?:filed|submitted) by|"
           r"claims? must be|exclude|opt[- ]?out)[^.]{0,40}?")
    cued = re.search(cue + r"(" + DATE_RE + r")", t, re.IGNORECASE)
    if cued:
        d = re.search(DATE_RE, cued.group(0))
        if d:
            return d.group(0)
    any_date = re.search(DATE_RE, t)
    return any_date.group(0) if any_date else ""


def parse_date(s):
    if not s:
        return None
    for fmt in ("%B %d, %Y", "%B %d %Y", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(s.strip(), fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


# =========================================================================
# Seen store (seen.json committed back to the repo)
# =========================================================================
def load_seen():
    path = CONFIG["seen_file"]
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def save_seen(seen):
    with open(CONFIG["seen_file"], "w", encoding="utf-8") as f:
        json.dump(seen, f, indent=2, ensure_ascii=False)


# =========================================================================
# Orchestrator
# =========================================================================
def run_weekly_digest():
    seen = load_seen()
    now = datetime.now(timezone.utc)

    raw = parse_settlements(fetch_sources())

    strong, possible, upcoming, new_found = [], [], [], []

    for item in raw:
        if not item["url"]:
            continue
        ev = score_eligibility(item)
        is_new = item["url"] not in seen
        deadline_date = parse_date(item["deadline"])
        days_left = None
        if deadline_date:
            days_left = (deadline_date - now).days
        deadline_soon = (days_left is not None and 0 <= days_left <= CONFIG["deadline_window_days"])

        enriched = {"item": item, "eval": ev, "days_left": days_left}

        if is_new:
            seen[item["url"]] = {
                "title": item["title"],
                "deadline": item["deadline"] or "",
                "first_seen": now.strftime("%Y-%m-%d"),
                "score": ev["score"],
            }
            new_found.append(enriched)
            if ev["tier"] == "strong":
                strong.append(enriched)
            elif ev["tier"] == "possible":
                possible.append(enriched)
        elif deadline_soon and ev["tier"] != "none":
            upcoming.append(enriched)

    strong.sort(key=lambda e: -e["eval"]["score"])
    possible.sort(key=lambda e: -e["eval"]["score"])
    new_found.sort(key=lambda e: -e["eval"]["score"])
    upcoming.sort(key=lambda e: e["days_left"] if e["days_left"] is not None else 999)

    save_seen(seen)

    if strong or possible or upcoming or new_found:
        send_digest_email({
            "strong": strong, "possible": possible,
            "upcoming": upcoming, "new_found": new_found,
        })
    else:
        print("Nothing to report this week.")


# =========================================================================
# Email
# =========================================================================
def esc(s):
    return (str(s or "").replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def render_section(heading, entries):
    html = (f'<h3 style="margin-bottom:6px;margin-top:22px">{heading} '
            f'<span style="color:#999;font-weight:normal">({len(entries)})</span></h3>')
    if not entries:
        return html + '<p style="color:#999;margin-top:0">None this week.</p>'
    for e in entries:
        it = e["item"]
        why = ", ".join(
            f'{r["keyword"]} <span style="color:#999">({r["bucket"]})</span>'
            for r in e["eval"]["reasons"]) or "—"

        deadline_line = ""
        if it["deadline"]:
            soon = (e["days_left"] is not None and 0 <= e["days_left"] <= CONFIG["deadline_window_days"])
            left = (f' ({e["days_left"]} days left)'
                    if e["days_left"] is not None and e["days_left"] >= 0 else "")
            closing = (' <span style="color:#c62828;font-weight:bold">⏰ closing soon</span>'
                       if soon else "")
            deadline_line = f'<div><b>Deadline:</b> {esc(it["deadline"])}{left}{closing}</div>'

        html += '<div style="border:1px solid #e0e0e0;border-radius:8px;padding:12px;margin:8px 0">'
        html += f'<div style="font-size:15px;font-weight:bold;margin-bottom:4px">{esc(it["title"])}</div>'
        html += f'<div><b>Confidence score:</b> {e["eval"]["score"]} ({e["eval"]["tier"]})</div>'
        html += f'<div><b>Why it matched:</b> {why}</div>'
        html += deadline_line
        html += f'<div><b>Source:</b> {esc(it["source"])}</div>'
        if it["url"]:
            html += f'<div><a href="{esc(it["url"])}">Open settlement / source page →</a></div>'
        html += ('<div style="font-size:12px;color:#888;margin-top:6px">⚠️ Verify '
                 'eligibility manually on the official claim site before filing.</div>')
        html += "</div>"
    return html


def build_html(buckets):
    html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;color:#222">'
    html += '<h2 style="margin-bottom:4px">Weekly settlement eligibility digest</h2>'
    html += ('<p style="color:#666;margin-top:0">Possible matches against your profile. '
             'This is <b>not legal advice</b> and does not confirm you qualify.</p>')
    html += render_section("✅ Strong matches", buckets["strong"])
    html += render_section("\U0001f7e1 Possible matches", buckets["possible"])
    html += render_section("⏰ Upcoming deadlines", buckets["upcoming"])
    html += render_section("\U0001f195 New settlements found", buckets["new_found"])
    html += '<hr style="margin-top:24px">'
    html += ('<div style="background:#fff8e1;border:1px solid #ffe082;border-radius:6px;'
             'padding:12px;font-size:13px">')
    html += '<b>⚠️ Stay safe from scams</b><ul style="margin:8px 0 0 18px;padding:0">'
    html += '<li><b>Never pay to claim a settlement.</b> Legitimate claims are free.</li>'
    html += ('<li><b>Verify the official claim site</b> before entering any information. '
             'Find it via the court / administrator, not via an email link.</li>')
    html += ('<li><b>Watch for phishing.</b> Be suspicious of urgency, unexpected '
             'texts/emails, and requests for SSN, bank, or password.</li>')
    html += "</ul></div>"
    html += ('<p style="font-size:12px;color:#888;margin-top:12px">This automated monitor '
             'suggests <i>possible</i> eligibility only. Always read the official notice and '
             'verify your eligibility manually before filing a claim. It is not a substitute '
             'for legal advice.</p>')
    html += "</div>"
    return html


def html_to_text(html):
    return strip_html(re.sub(r"</(div|p|li|h2|h3|tr)>", "\n", html, flags=re.IGNORECASE))


def send_digest_email(buckets):
    sender = os.environ.get("GMAIL_ADDRESS", "").strip()
    # Google shows the App Password as 4 space-separated groups; a paste can
    # include regular OR non-breaking (\xa0) spaces. SMTP AUTH needs ASCII with
    # no whitespace, so strip every whitespace char, not just the ends.
    password = re.sub(r"\s+", "", os.environ.get("GMAIL_APP_PASSWORD", ""))
    to = CONFIG["email"] or sender
    if not sender or not password:
        print("ERROR: GMAIL_ADDRESS / GMAIL_APP_PASSWORD env not set.", file=sys.stderr)
        sys.exit(1)

    html = build_html(buckets)
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Weekly settlement eligibility digest"
    msg["From"] = f"Settlement Monitor <{sender}>"
    msg["To"] = to
    msg.attach(MIMEText(html_to_text(html), "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(sender, password)
        server.sendmail(sender, [to], msg.as_string())
    print(f"Digest sent to {to}")


if __name__ == "__main__":
    run_weekly_digest()
