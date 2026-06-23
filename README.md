# Better Dog Supplements — Social Dashboard

An Agorapulse-style **weekly social media metrics dashboard** for agency client
reporting. Reports **Posts, Views, Reach** (plus **Watch time** for YouTube)
across **Instagram, Facebook, and YouTube** on a **Friday → Thursday**
weekly cycle, with **week-over-week up/down** and **line-graph trends**.
Currently configured for **Better Dog Supplements** (@betterdogsupplements).

Runs on realistic **demo data immediately** — no API keys required — then wires
up to each platform's official API as you get credentials.

![mode: demo or live]

---

## Quick start

You need [Node.js 18+](https://nodejs.org). Then, from this folder:

```powershell
npm install
npm start
```

Open <http://localhost:4000>. You'll see the Better Dog Supplements brand with
full weekly charts and tables. A **DEMO DATA** badge in the top-right confirms
you're on mock data.

---

## What you get

- **Weekly cycle (Fri → Thu)** — headline numbers are the most recent completed
  week; "this week" vs. "prior week" everywhere.
- **KPI header** — Posts, Views, Reach, and YouTube Watch time totals for the
  week, each with **▲/▼ week-over-week %**.
- **Trend line charts** — Posts, Views, Reach (per platform + a Total line) and
  YouTube Watch time (hours), plotted over the last 8 / 12 / 26 weeks.
- **This-week-by-platform table** — Posts, Views, Reach, Watch time per platform
  plus a Total row, each cell showing its WoW change.
- **Export CSV** — this-week summary with WoW per platform + full weekly history,
  ready for a client deck or email.
- **Multi-brand** — add more brands in `server/config/clients.json`; the Brand
  switcher picks between them.

---

## Going live with real data

1. `copy .env.example .env`
2. Follow **[docs/API_SETUP.md](docs/API_SETUP.md)** to register a developer app
   per platform and get access tokens.
3. Paste tokens into `.env` and set the account `id`s in
   `server/config/clients.json`.
4. Set `USE_DEMO_DATA=false` and restart.

Each platform flips to live independently — anything without credentials stays
on demo data, so you can onboard one platform at a time. The top-right badge
switches to **LIVE** once demo mode is off.

> **The honest part:** live data requires official API access. Some scopes need
> the platform to review and approve your app, and your clients must grant your
> agency access to their accounts/pages. There's no shortcut around this — it's
> how Agorapulse, Sprout, and every other tool does it too. `API_SETUP.md` walks
> through exactly what to request.

---

## How it's built

```
server/
  index.js               Express server + REST API
  config/clients.json    Your clients and their accounts (edit this)
  connectors/
    index.js             Registry — dispatches to the right platform
    demoData.js          Realistic demo-data generator (the data shape spec)
    instagram.js         Meta Graph API (live) + demo fallback
    facebook.js          Meta Graph API (live) + demo fallback
    youtube.js           YouTube Data + Analytics API (live) + demo fallback
public/
  index.html  styles.css  app.js   The dashboard UI (Chart.js)
docs/
  API_SETUP.md           Per-platform credential setup
```

**Connector contract:** every connector exposes
`fetchMetrics({ clientId, account, days, now })` and returns one normalized
shape (documented at the top of `demoData.js`). The UI never knows whether the
numbers came from a live API or demo data — which is what makes the swap
seamless. To add a platform (e.g. LinkedIn or X), copy a connector, implement
its `fetchMetrics`, and register it in `connectors/index.js`.

### REST API

| Endpoint | Description |
|---|---|
| `GET /api/clients` | List clients for the switcher |
| `GET /api/metrics/:clientId?weeks=8&platforms=instagram,youtube` | Weekly metrics for a client |
| `GET /api/status` | Demo/live mode + which credentials are present |

---

## Roadmap ideas

- Scheduled weekly snapshots into a local DB so history accrues automatically.
- Branded PDF export of the weekly report for client decks.
- Add platforms (TikTok, LinkedIn, X) by dropping in a new connector.
- Automatic OAuth token refresh per client.
