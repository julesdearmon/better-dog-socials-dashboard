# Better Dog Supplements — Social Dashboard: Handoff / Status

_Last updated by Claude: June 23, 2026._

## What this is
A local, single-brand **organic** social-media metrics dashboard for **Better Dog Supplements** (AGM Agency client reporting). It's a static site (vanilla HTML/CSS/JS + Chart.js) that opens by double-clicking `public/index.html`. Real data comes from the **Supermetrics MCP connector** inside the Claude app.

- Project folder: `C:\Users\Jules\OneDrive\Desktop\Claude - Social Media Dashboard`
- Key files: `public/index.html`, `public/app.js`, `public/styles.css`, `public/data.json`, `public/realdata.js` (the dashboard reads `window.REAL_DATA` from `realdata.js` because browsers block `fetch()` of local files).
- No Node/Python on PATH; a usable Node ships with Adobe at `C:\Program Files\Adobe\Adobe Photoshop 2026\node.exe`.

## Accounts / data sources (Supermetrics)
- **Instagram** (IGI) account `17841475238822164` — @betterdogsupplements
- **Facebook** (FB) page `674626722402999`
- **YouTube** (YT2) channel `UC9rUabwMqe2C98J2l1NDz2g`
- **TikTok** (TIKBA) account `betterdogsupplements`

## Metrics & rules
- Tracks **Views, Reach, Watch time (YouTube only)**, and **Posts** (shown last; posting volume is treated as a contributing factor, not a headline metric).
- Weeks run **Friday → Thursday**. Grouping toggle: Daily / Weekly / Monthly (controls chart bucketing only).
- **ORGANIC ONLY** (the whole point):
  - **YouTube**: views & watch time come from the **TrafficSources** report with the **`ADVERTISING` source excluded** (ads were ~64–74% of raw YT views). `metrics.youtube.organicOnly = true`.
  - **Instagram & Facebook**: already organic — ads run as **separate Ads-Manager creatives** (not boosted posts), so post-level metrics never include paid. (Supermetrics' IG connector has no organic/paid split anyway.)
  - A visible "Organic only" note explains this on the dashboard.
- **Never fabricate data** — only real Supermetrics values.

## Features built
- Platform selector ("Show:") = **[ Total (All Platforms) ] [ Instagram ] [ Facebook ] [ YouTube ] [ TikTok ]** (first = default all-platforms view; the old separate "Total" button was removed). Click a platform to show only its line.
- **Custom date range** via a click-to-highlight calendar (click start day, then end day; hover preview; month nav) + quick presets: **Last week / Last 4 weeks / Last month / Last 3 months**.
- **KPI tiles** total over the selected range and compare to the **equal-length window immediately before** (green up / red down %).
- **Charts** (Views, Reach, YouTube watch time, Posts). Click a point → **Data insights** panel (click same point again to hide; sits directly below the charts, **above** Overall analysis).
- **Overall analysis** card — 100% data-derived, never invented; adapts to week/month/range; decomposes what drove the change (more/fewer posts vs higher/lower views-per-post vs a breakout post), shows engagement rate + avg views/post, "what's working by format," and top posts as clickable links. Deeper per-platform view when a single platform is selected.
- **Top Performing Content** — top posts per platform with first-sentence captions, type, date, views, reach, engagement (linked).
- Header note: **"Live data through &lt;last data date&gt; · last updated &lt;timestamp&gt;"**. Rule: "last updated" is stamped **only on a real Supermetrics pull**, never on code/layout edits.

## Current data state
- **Data through June 21, 2026; "last updated" = Jun 22, 2026, 1:59 PM** (a manual pull). All four platforms live including TikTok (TikTok is currently the biggest by views).
- It has **not** advanced to June 23 because no refresh has completed since (see open problem).

## ⚠ THE OPEN PROBLEM — automatic daily refresh isn't working
There's a daily scheduled task `refresh-better-dog-dashboard` (6:05 AM, enabled) that's supposed to re-pull all platforms and rebuild the data files **and** stamp the "last updated" note. It **fires but does not complete**, so the data/date don't advance on their own.

Root causes identified:
1. **Permission prompts** on unattended runs — **FIXED**: pre-authorized in `.claude/settings.local.json` (Supermetrics tools, `Write/Edit(public/**)`, the Adobe-node Bash commands).
2. **The Supermetrics connector keeps disconnecting** — this is the main blocker. It's frequently not connected/authed when the task fires (and was disconnected even during live sessions). No connection = no pull = no update. Reconnecting a connector is an in-app action Claude can't do programmatically.
3. Scheduled tasks only run while the **Claude app is open** and the **computer is awake** at that time.

A second task `weekly-better-dog-analysis` exists but is **disabled** (its pre-written prose was replaced by the live data-only analysis).

## How to refresh manually (works when Supermetrics is connected)
Ask Claude: "refresh the Better Dog dashboard." It follows `C:\Users\Jules\.claude\scheduled-tasks\refresh-better-dog-dashboard\SKILL.md` (pull window = 300 days back through yesterday; organic YT; first-sentence captions; writes `data.json` + `realdata.js`; stamps `updatedAt`).

## Permanent fix — hosting (✅ BUILT 2026-06-23, pending user setup)
Chosen architecture: **Supermetrics API → GitHub Actions (daily) → GitHub Pages.** Removes dependence on the computer being on, the app being open, and the flaky in-app connector, and gives a real shareable URL. Code-complete in the repo, not yet deployed.

Added files:
- `scripts/build-data.mjs` — server-side rebuild script. Pulls all 4 platforms from the Supermetrics **Query API** (`POST https://api.supermetrics.com/enterprise/v2/query/data/json`, Bearer auth via `SUPERMETRICS_API_KEY`). Faithful port of the daily-refresh SKILL: organic-only YouTube, first-sentence captions, full schema, stamps `updatedAt`, writes `public/data.json` + `public/realdata.js`.
- `.github/workflows/refresh.yml` — daily cron + manual button + on-push; deploys `public/` to Pages. If the API-key secret is missing it deploys the committed `data.json` as a seed so the site still goes live.
- `DEPLOY.md` — step-by-step user setup (GitHub Desktop, enable Pages, add secret, run).
- `package.json` gained a `build` script.

**To go live, the user must (see DEPLOY.md):** get a Supermetrics API key (⚠ may require Enterprise tier — trial might not include API access; fallback is a Google Sheets export, changing only the data layer), publish the repo to GitHub, set Pages source = GitHub Actions, add the `SUPERMETRICS_API_KEY` repo secret, and Run the workflow. First run prints ✓/✗ per platform — the `ds_id`/field codes mirror the MCP but are unverified against the public API, so a source may need a small tweak.

## Shareable build prompts (to recreate this for other brands)
Four `.md` files in the project root. **Canonical = `BUILD-DASHBOARD-PROMPT.md`** (one self-contained prompt: connect Supermetrics → interview → build spec → design CSS → automation). Others: `DASHBOARD-SETUP-INTERVIEW-PROMPT.md`, `DASHBOARD-PROMPT-TEMPLATE.md`, `DASHBOARD-DESIGN-AND-AUTOMATION.md`.

## Next steps / decisions pending
1. **Deploy the hosting pipeline** — follow `DEPLOY.md` (Supermetrics API key, push to GitHub, enable Pages, add secret, run). This is the real fix; once live it supersedes the local file + in-app connector + scheduled tasks below. ⚠ Confirm the Supermetrics plan includes **API access** (else use the Google Sheets fallback).
2. **(Interim only)** To refresh the *local* dashboard before hosting is live: reconnect the Supermetrics connector and restart the Claude app / start a fresh chat (connector tools only load at session start), then "refresh the Better Dog dashboard."
3. (Optional) YouTube per-video "top content" views still include ad views — could be split per-video by traffic source if desired.
