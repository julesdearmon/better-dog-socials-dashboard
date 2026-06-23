# Dashboard — Design Reference & Automation Guide

Companion to the build prompts. Part A is the **exact design/formatting** to match.
Part B is how to set up the **daily auto-refresh** and keep it actually running.

---

## Part A — Design reference (match this look)

The entire look is driven by the stylesheet below. To re-brand it, a recipient only needs to
change the **`:root` color variables** (and swap the logo). The layout is a centered `max-width:1280px`
column, white rounded **cards** with a soft shadow, a 4-up **KPI** grid, a 2-up **chart grid**
(Chart.js line charts in fixed-height `.chart-box`es), pill-shaped filter **chips**, and accent-bordered
**analysis/insight** cards.

> Tip for the builder (Claude): use this `styles.css` as-is as the design baseline, then only edit the
> brand colors in `:root`. The HTML structure is a `.topbar` (logo + controls) over a `.dashboard`
> main containing: platform chips, KPI grid, the analysis card, the chart grid, the by-platform table,
> and the Top Content section. Data is embedded as `window.REAL_DATA` in `realdata.js` and read by `app.js`.

**Brand tokens to change per brand** (top of the file):
```
--bg / --panel / --panel-2 / --line   = neutral background + card colors
--text / --muted                      = text colors
--accent / --accent-2                 = brand primary + secondary (drives active chips, links, buttons)
--good (#4e9e22) / --bad (#802f1e)     = up/down (green/red) — keep accessible
--ig/--fb/--tt/--yt                    = per-platform dot colors (usually leave as the platform brand colors)
```

### styles.css (full)
```css
:root {
  /* CHANGE THESE per brand */
  --bg: #fcffe8;          /* page background (cream) */
  --panel: #ffffff;       /* card background */
  --panel-2: #f4f8e6;     /* nested/soft blocks */
  --line: #d9e1e8;        /* borders */
  --text: #222322;        /* primary text (near-black) */
  --muted: #717869;       /* secondary text */
  --accent: #88cc33;      /* brand primary */
  --accent-2: #ffa630;    /* brand secondary */
  --good: #4e9e22;        /* "up" green */
  --bad: #802f1e;         /* "down" red */
  --ig: #f97316; --fb: #1877f2; --tt: #8b5cf6; --yt: #ff0000; /* platform dots */
  --radius: 14px;
  --shadow: 0 4px 16px rgba(34, 35, 34, 0.08);
}

* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: radial-gradient(1100px 520px at 85% -15%, #eef6d6 0%, var(--bg) 55%);
  color: var(--text); min-height: 100vh;
}

/* Topbar */
.topbar { display: flex; align-items: center; justify-content: space-between; padding: 16px 28px; border-bottom: 1px solid var(--line); background: rgba(252,255,232,0.85); backdrop-filter: blur(8px); position: sticky; top: 0; z-index: 10; }
.brand { display: flex; align-items: center; gap: 16px; }
.brand-logo { height: 46px; width: auto; display: block; }
.brand-sub { font-size: 12px; color: var(--muted); padding-left: 16px; border-left: 1px solid var(--line); }

.live-note { background: #eaf7d9; border: 1px solid #bfe39a; color: #3d6b14; border-radius: 10px; padding: 10px 14px; font-size: 12px; margin-bottom: 16px; }
.demo-banner { background: #fff3e0; border: 1px solid #ffd9a0; color: #7a4a00; border-radius: 10px; padding: 12px 16px; font-size: 13px; line-height: 1.5; margin-bottom: 16px; }
.weekly-note { font-size: 13px; color: var(--muted); margin: 0 0 18px; }
.weekly-note strong { color: var(--text); }
.page-title { font-size: 24px; font-weight: 750; letter-spacing: -0.4px; text-align: center; margin: 4px 0 18px; }
.section-title { font-size: 16px; font-weight: 700; margin: 0 0 12px; }
.section-title .scope { color: var(--muted); font-weight: 500; }

/* Platform chips */
.platform-filter { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
.pf-label { font-size: 12px; color: var(--muted); margin-right: 2px; }
.pf-chip { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--line); background: var(--panel); color: var(--muted); border-radius: 999px; padding: 6px 13px; font-size: 13px; cursor: pointer; transition: all .12s; }
.pf-chip .pf-dot { width: 9px; height: 9px; border-radius: 50%; opacity: .3; }
.pf-chip:hover { border-color: var(--muted); }
.pf-chip.on { color: var(--text); border-color: var(--text); font-weight: 600; }
.pf-chip.on .pf-dot { opacity: 1; }

/* Controls + calendar + segmented toggle */
.controls { display: flex; align-items: center; gap: 14px; }
.control { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--muted); }
.control select { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; font-size: 13px; min-width: 150px; }
.cal-wrap { position: relative; }
.cal-btn { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 7px 12px; font-size: 13px; cursor: pointer; min-width: 180px; text-align: left; font-family: inherit; }
.cal-btn:hover { border-color: var(--muted); }
.cal-pop { position: absolute; top: calc(100% + 6px); left: 0; z-index: 30; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); padding: 12px; width: 272px; }
.cal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.cal-head span { font-size: 13px; font-weight: 650; }
.cal-nav { border: 1px solid var(--line); background: var(--panel); border-radius: 6px; width: 26px; height: 26px; cursor: pointer; font-size: 14px; line-height: 1; color: var(--text); }
.cal-nav:hover { background: var(--panel-2); }
.cal-dow { display: grid; grid-template-columns: repeat(7,1fr); gap: 2px; margin-bottom: 4px; }
.cal-dow span { text-align: center; font-size: 10px; color: var(--muted); }
.cal-grid { display: grid; grid-template-columns: repeat(7,1fr); gap: 2px 0; }
.cal-cell { border: none; background: transparent; border-radius: 6px; height: 30px; font-size: 12px; cursor: pointer; color: var(--text); padding: 0; }
.cal-cell.empty { visibility: hidden; }
.cal-cell:hover:not(.disabled):not(.sel) { background: var(--panel-2); }
.cal-cell.disabled { color: #c8cdbd; cursor: default; }
.cal-cell.in-range { background: #eaf7d9; border-radius: 0; }
.cal-cell.range-start, .cal-cell.range-end, .cal-cell.sel { background: var(--accent); color: #fff; font-weight: 650; }
.cal-cell.range-start { border-radius: 6px 0 0 6px; }
.cal-cell.range-end { border-radius: 0 6px 6px 0; }
.cal-cell.range-start.range-end { border-radius: 6px; }
.cal-foot { font-size: 11px; color: var(--muted); margin-top: 8px; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--panel); }
.seg button { border: none; background: transparent; color: var(--muted); padding: 7px 14px; font-size: 13px; cursor: pointer; border-right: 1px solid var(--line); }
.seg button:last-child { border-right: none; }
.seg button:hover { background: var(--panel-2); }
.seg button.active { background: var(--accent); color: #fff; font-weight: 600; }
.btn { align-self: flex-end; background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; transition: background .15s; }
.btn:hover { background: var(--panel-2); }
.badge { align-self: flex-end; font-size: 11px; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
.badge.demo { color: #a85f00; border-color: #ffd9a0; background: #fff3e0; }
.badge.live { color: var(--good); border-color: #bfe39a; background: #eaf7d9; }

/* Layout */
.dashboard { padding: 24px 28px 60px; max-width: 1280px; margin: 0 auto; }
.kpis { display: grid; grid-template-columns: repeat(4,1fr); gap: 16px; margin-bottom: 22px; }
.kpi { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px; box-shadow: var(--shadow); }
.kpi .label { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
.kpi-note { font-size: 10px; opacity: .7; }
.kpi .value { font-size: 28px; font-weight: 720; letter-spacing: -0.5px; }
.delta { display: inline-block; font-size: 12px; margin-top: 8px; }
.delta.up { color: var(--good); } .delta.down { color: var(--bad); } .delta.flat { color: var(--muted); }
.mini { font-size: 11px; margin-left: 6px; }
.mini.up { color: var(--good); } .mini.down { color: var(--bad); } .mini.flat { color: var(--muted); }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 22px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px 20px; box-shadow: var(--shadow); margin-bottom: 22px; }
.card-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14px; }
.card-head h2 { font-size: 15px; margin: 0; font-weight: 650; }
.card-sub { font-size: 12px; color: var(--muted); }
.chart-card { margin-bottom: 0; }
.chart-box { position: relative; height: 280px; width: 100%; }
.chart-note { font-size: 11px; color: var(--muted); margin: 10px 2px 0; line-height: 1.4; }
.chart-note strong { color: var(--text); }

/* Tables */
.table-wrap { overflow-x: auto; }
.posts-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.posts-table th, .posts-table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.posts-table th { color: var(--muted); font-weight: 550; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; }
.posts-table td.num, .posts-table th.num { text-align: right; font-variant-numeric: tabular-nums; }
.posts-table td.muted { color: var(--muted); }
.posts-table tfoot .total-row td { border-top: 2px solid var(--line); border-bottom: none; font-weight: 700; }
.posts-table .pill { font-size: 11px; padding: 3px 8px; border-radius: 999px; color: #fff; }
.pill.instagram { background: var(--ig); } .pill.facebook { background: var(--fb); } .pill.tiktok { background: var(--tt); } .pill.youtube { background: var(--yt); }
.type-tag { display: inline-block; font-size: 11px; color: var(--muted); background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; padding: 2px 8px; white-space: nowrap; }
.content-link { color: var(--text); text-decoration: none; }
.content-link:hover { text-decoration: underline; color: var(--accent); }
.content-group { margin-bottom: 22px; }
.cg-head { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 2px solid var(--line); }
.cg-dot { width: 11px; height: 11px; border-radius: 50%; flex: none; }
.cg-name { font-size: 15px; font-weight: 700; }
.cg-empty { font-size: 13px; color: var(--muted); }
.content-controls { display: flex; gap: 8px; }
.content-controls select { background: var(--panel); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; font-size: 13px; }

/* Overall analysis + click insight cards (accent border) */
.overview-card, .insight-card { border-color: var(--accent); }
.ov-headline { font-size: 14px; line-height: 1.65; margin: 0 0 12px; }
.ov-headline strong { color: var(--text); }
.ov-delta { font-weight: 600; white-space: nowrap; }
.ov-delta.up { color: var(--good); } .ov-delta.down { color: var(--bad); }
.ov-reason { font-size: 13px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 11px 13px; margin: 0 0 14px; line-height: 1.55; }
.ov-reason strong { color: var(--text); }
.ov-list { list-style: none; padding: 0; margin: 0; }
.ov-list li { font-size: 13px; padding: 9px 0; border-bottom: 1px solid var(--line); line-height: 1.5; }
.ov-list li:last-child { border-bottom: none; }
.ov-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 7px; }
.ov-sub { font-size: 13px; font-weight: 650; margin: 6px 0; }
.ov-top-list { margin: 0; padding-left: 20px; }
.ov-top-list li { font-size: 13px; padding: 5px 0; line-height: 1.5; }
.ov-top-meta { color: var(--muted); font-size: 12px; }
.ov-fmt { list-style: none; margin: 0 0 6px; padding: 0; }
.ov-fmt li { font-size: 13px; padding: 5px 0; border-bottom: 1px dashed var(--line); }
.ov-inactive { font-size: 12px; color: var(--muted); margin: 10px 0 0; }
.chart-hint { font-size: 12px; color: var(--muted); margin: 2px 0 16px; }
.insight-headline { font-size: 13px; color: var(--muted); margin: 0 0 6px; }
.insight-value { font-size: 26px; font-weight: 720; }
.spike-badge { font-size: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
.spike-badge.hot { color: var(--good); background: #eaf7d9; border-color: #bfe39a; }
.spike-badge.low { color: var(--bad); background: #fbeae6; border-color: #e6b8ad; }

/* Loading + responsive */
.loading { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(252,255,232,0.7); font-size: 14px; color: var(--muted); }
.loading.show { display: flex; }
@media (max-width: 900px) { .kpis { grid-template-columns: repeat(2,1fr); } .grid { grid-template-columns: 1fr; } .controls { flex-wrap: wrap; } }
```

> For a pixel-exact match (structure + behavior), also copy the project's `index.html` and `app.js`
> and just have Claude re-wire the data pulls and branding. The CSS above is the part most worth reusing.

---

## Part B — Automatic daily updates

The data only changes when it gets re-pulled, so set up a recurring refresh.

### 1. Create the scheduled task
Once the dashboard is built, ask Claude (in the same Claude Code project):

> "Create a scheduled task that re-pulls all platforms from Supermetrics and rebuilds the dashboard
> data files (data.json + realdata.js) every day at {{TIME}} {{TIMEZONE}}, following the same organic
> rules. Stamp 'last updated' only on a successful real pull."

Claude saves it as a task (a `SKILL.md` under `.claude/scheduled-tasks/`) on a daily cron.

### 2. Pre-approve permissions (one time)
Open the **Scheduled** panel in the Claude sidebar, find the task, and click **Run now once**.
Approve the Supermetrics + file-write prompts. After that one approval, future runs go through
unattended (otherwise each run would pause waiting for permission).

### 3. How it fires
- The task runs **only while the Claude app is open** on the computer.
- If the app is **closed** (or the computer is off/asleep) at the scheduled time, it runs **on next launch** —
  so you don't lose data, it just updates a little later.

---

## Part C — Keep the computer on so it can run

For a hands-off daily refresh at a set time (e.g. 6:00 AM), the computer must be **on and awake** and the
**Claude app open** at that time. Options:

**Easiest:** pick a refresh time when you're normally at your desk with Claude open (e.g. 9:00 AM), so it
just runs while you work. If exact timing doesn't matter, leave it — it'll refresh next time you open Claude.

**For an overnight/early-morning refresh (Windows 11):**
1. Keep the computer **plugged in and powered on** overnight, and leave the **Claude app running**.
2. Stop it from sleeping: **Settings → System → Power & battery → Screen and sleep** → set
   **"When plugged in, put my device to sleep after"** to **Never** (at least for the nights you need it).
   You can also set the screen to turn off (that's fine) while the device stays awake.
3. Optional, to wake from sleep instead of leaving it fully on: Windows **Task Scheduler** can wake the PC
   on a schedule (create a task → "Wake the computer to run this task"), but the **Claude app still has to be
   running**, so most people just disable sleep on the needed nights.

**Mac:** System Settings → **Battery / Energy** → enable "Prevent automatic sleeping when the display is off"
(plugged in), or use a scheduled wake under **Battery → Schedule**. The Claude app must be open.

> Reality check: this runs on your local machine, so "daily, untouched, forever" needs the machine on and the
> app open at that hour. If you want truly always-on refresh independent of your computer, that requires a
> hosted setup (a server + a scheduled job) — ask Claude about the hosted option separately.
