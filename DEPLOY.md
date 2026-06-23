# Deploying the Better Dog dashboard (hosted, auto-updating)

This moves the dashboard off your local machine and the in-app Supermetrics
connector. Once set up:

- The site lives at a **real URL** (works on your phone and for the team).
- It **rebuilds itself every morning** via GitHub Actions — nothing runs on your
  computer, no app needs to be open, and there's no connector to reconnect.
- Data comes straight from the **Supermetrics API**, not the in-Claude MCP.

**Architecture:** Supermetrics API → GitHub Actions (daily) → GitHub Pages.

---

## What's already built (in this repo)

| File | What it does |
| --- | --- |
| `scripts/build-data.mjs` | Pulls all 4 platforms from the Supermetrics API and rebuilds `public/data.json` + `public/realdata.js`. Faithful port of the daily-refresh logic (organic-only YouTube, first-sentence captions, Fri–Thu summary). |
| `.github/workflows/refresh.yml` | Runs the build daily (and on demand) and publishes `public/` to GitHub Pages. |
| `public/` | The dashboard itself (unchanged) — `index.html`, `app.js`, `styles.css`, `logo.png`, plus the data files. |

You do **not** need Node or git installed on your machine — everything runs on
GitHub's servers.

---

## One-time setup (about 15 minutes)

### Step 1 — Get a Supermetrics API key  ⚠️ requires API access on your plan
The API is a different product from the in-Claude connector and the trial may not
include it (full API access is typically the Enterprise tier — confirm with your
Supermetrics rep / billing).

1. Sign in at **https://hub.supermetrics.com** → **API keys** (or
   **Team settings → API**).
2. Create a key. Copy it somewhere safe — you'll paste it into GitHub in Step 4.
3. Make sure the same Supermetrics team has the four Better Dog accounts authorized
   (Instagram, Facebook, YouTube, TikTok) — these are the ones already wired into the
   build script.

> If your plan does **not** include API access, tell me — we can switch the data
> source to a scheduled Google Sheets export instead (the build script's data layer
> is the only part that would change).

### Step 2 — Put this project on GitHub
Easiest without command-line git:

1. Create a free account at **https://github.com** if you don't have one.
2. Install **GitHub Desktop** (https://desktop.github.com) — a simple app, no
   terminal needed.
3. In GitHub Desktop: **File → Add local repository** → choose this folder
   (`Claude - Social Media Dashboard`) → it'll offer to **create a repository** →
   accept → **Publish repository** (keep it **Private**). Name it e.g. `better-dog-dashboard`.

   *(Alternative: on github.com create a new repo, then drag-and-drop these files
   into the web "Add file → Upload files" page.)*

### Step 3 — Turn on GitHub Pages
1. On github.com, open your new repo → **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
   (No branch to pick — the included workflow handles it.)

### Step 4 — Add your Supermetrics API key as a secret
1. Repo → **Settings → Secrets and variables → Actions → New repository secret**.
2. **Name:** `SUPERMETRICS_API_KEY`  ·  **Value:** the key from Step 1.
3. Save.

### Step 5 — Run it
1. Repo → **Actions** tab → **Refresh & deploy dashboard** → **Run workflow**.
2. Watch the run. The **"Pull fresh data from Supermetrics"** step prints a
   ✓/✗ line per platform and a summary of the latest Fri–Thu week.
3. When it finishes, the **Deploy** step shows your live URL, typically:
   `https://<your-username>.github.io/better-dog-dashboard/`

That URL is your shareable dashboard. From now on it refreshes every morning
automatically.

---

## Tuning

- **Refresh time:** edit the `cron` line in `.github/workflows/refresh.yml`.
  It's in **UTC**. `'5 10 * * *'` ≈ 6:05 AM US-Eastern. (Pacific ≈ add 3 hours →
  `'5 13 * * *'`; pick whatever you like — pick a time after midnight in your zone
  so "yesterday" is complete.)
- **"Last updated" timezone:** the `DISPLAY_TZ` env in the workflow (default
  `America/New_York`) controls the friendly stamp shown on the dashboard.
- **History window:** defaults to 300 days. Set a `WINDOW_DAYS` env in the workflow
  to change it.

---

## If a platform shows ✗ in the logs

The build prints the exact Supermetrics error per platform. The most likely first-run
snags and fixes:

- **Auth / 401:** the API key is wrong or lacks API access (Step 1).
- **Unknown `ds_id` or field:** Supermetrics occasionally uses a slightly different
  data-source code on the public API than the in-app connector. The codes are at the
  top of `scripts/build-data.mjs` (`ACCT`) and the field lists are in each
  `pull*()` function — they mirror the connector exactly, but if one errors, paste
  the log line back to me and I'll adjust it.
- A single failed platform doesn't sink the run — the others still deploy, matching
  the old "keep the sources that worked" behavior.

---

## Local sanity check (optional, needs Node)

```bash
SUPERMETRICS_API_KEY=your_key node scripts/build-data.mjs
```
On this Windows machine, Node ships with Adobe:
`"C:\Program Files\Adobe\Adobe Photoshop 2026\node.exe" scripts/build-data.mjs`
(set the key first). It rewrites `public/data.json` + `public/realdata.js` and prints
the same summary line.
