# Build-My-Social-Dashboard — single prompt

Paste **everything inside the box below** into **Claude Code** (with the Supermetrics connector added).
Claude will connect your accounts, ask you a few questions, and build the dashboard.

---

> You're going to help me build an **organic** social-media metrics dashboard for **one brand**, using the **Supermetrics MCP connector** for real data. Work with me interactively: **ask me ONE question at a time and wait for my answer before the next.** Keep it friendly and non-technical. **Never fabricate or estimate data** — only use real values returned by Supermetrics; if something isn't connected or returns nothing, tell me plainly and help me fix it rather than inventing numbers.
>
> ### STEP 1 — Connect the brand's accounts in Supermetrics (do this first)
> Walk me through it and don't continue until it's confirmed:
> 1. Tell me to open the **Supermetrics connector** and sign in at **hub.supermetrics.com** (token management).
> 2. For each platform I want, connect the **brand's own account**: **Instagram Insights, Facebook Page Insights, YouTube, TikTok Organic.**
> 3. Remind me that **Instagram and TikTok must be Business/Creator accounts** (personal accounts return no data), and to connect the **exact brand accounts**, not a personal or agency one.
> 4. When I say they're connected, run `data_source_discovery` and `accounts_discovery` and show me which accounts you can actually see per platform. If one is missing or wrong, help me reconnect it. Only continue once I confirm the right accounts are connected.
>
> ### STEP 2 — Interview me, one question at a time
> Ask these in order (one per message, confirm, then next):
> 1. Brand name? (and a short version for headlines)
> 2. Which platforms — Instagram, Facebook, YouTube, and/or TikTok?
> 3. For each platform I picked, which handle/account? (Match to what you saw in Supermetrics.)
> 4. How do we run ads: **separate ad creatives** in Ads Manager, **boosting organic posts**, or **no ads**? (Explain the difference if I'm unsure — it decides how you keep the numbers organic.)
> 5. Brand colors — primary and accent (hex)? And a logo image (file path) or none?
> 6. What time zone are we in, and what time each day should the dashboard auto-refresh?
> 7. Anything specific I want the analysis to emphasize?
>
> ### STEP 3 — Verify, then build
> Re-pull a small sample for each connected platform to confirm real data comes back; tell me what you found. Then build the dashboard.
>
> ### What to build
> A single-brand **organic** social dashboard as static **HTML/CSS/vanilla-JS + Chart.js** that opens by double-clicking a local file. Because browsers block `fetch()` of local files, embed the data in **`realdata.js`** as `window.REAL_DATA = {…}` (also write `data.json`, read it first when served over http). Brand it with my colors + logo.
>
> **Metrics & rules:**
> - Track **Views** and **Reach**, plus **Watch time** for YouTube only. Also track post count but show it **last** (order: Views, Reach, Watch time, Posts) and treat posting volume as a *contributing factor*, not a headline metric.
> - Bucket each post's lifetime views/reach by its **post/creation date** (Instagram, Facebook, TikTok — use TikTok's "videos" report). **YouTube has no reach** — exclude it from reach everywhere and show "—".
> - **ORGANIC ONLY:**
>   - **YouTube:** pull views & watch time from the **TrafficSources** report and **exclude the `ADVERTISING` traffic source** (ads otherwise inflate YouTube heavily). Use LatestVideos for post counts.
>   - **Instagram & Facebook:** if my ads are *separate creatives*, post metrics are already organic — no change. If I *boost posts*, tell me paid leaks in and Instagram can't be cleanly split via Supermetrics.
>   - Show a visible **"Organic only"** note explaining this.
> - Use the **first sentence of each caption** as the post title (Instagram media_caption, Facebook post_message, TikTok video caption; YouTube uses its real video title).
> - Use the Supermetrics discovery tools to find the correct account IDs and field names for THIS brand — don't assume.
>
> **Features:**
> 1. Platform selector ("Show:") with **All Platforms**, one chip per platform, and **Total** — clicking shows only that line.
> 2. **Custom date range** via a click-to-highlight calendar (click a start day, then an end day, with hover preview) plus quick presets: **Last week, Last 4 weeks, Last month, Last 3 months**.
> 3. **Daily / Weekly / Monthly** toggle that controls how the trend charts are grouped (weeks = Friday→Thursday). Default weekly.
> 4. **KPI tiles** that total over the selected range and compare to the **equal-length window immediately before** it (up/down %, green up / red down).
> 5. **Trend charts** per metric; clicking a point opens a small **"Data insights"** panel (data only) about that point.
> 6. An **"Overall analysis"** card that is **100% data-derived (never invented)** and adapts wording to the selection ("Month of …", "Week of …", or a custom range; "vs the previous month/week/period"). It should: give a plain headline of views/reach with up/down %; decompose **what contributed** to the change (more/fewer posts vs higher/lower views-per-post vs a single breakout post); show **engagement rate** and **average views per post**; rank **what's working by content format**; and list **top posts as clickable links**. When a single platform is selected, make it a deeper per-platform breakdown. Keep it readable; **do not use em dashes**; **bold each platform name only once** (at the start of its line).
> 7. A **Top Performing Content** section (top posts per platform: type, date, views, reach, engagement, linked).
> 8. A header note: **"Live data through &lt;last data date&gt; · last updated &lt;timestamp&gt;"**, where "last updated" is stamped **only when real data is actually pulled** (never on code edits).
>
> ### Design — match this look
> Use the CSS below as the stylesheet. To re-brand, change ONLY the `:root` color variables and the logo. Layout = centered `max-width:1280px` column; sticky topbar with logo + controls; white rounded cards with a soft shadow; a 4-up KPI grid; a 2-up chart grid with fixed-height chart boxes; pill-shaped filter chips; accent-bordered analysis/insight cards.
>
> ```css
> :root {
>   --bg:#fcffe8; --panel:#fff; --panel-2:#f4f8e6; --line:#d9e1e8;
>   --text:#222322; --muted:#717869; --accent:#88cc33; --accent-2:#ffa630;
>   --good:#4e9e22; --bad:#802f1e;
>   --ig:#f97316; --fb:#1877f2; --tt:#8b5cf6; --yt:#ff0000;
>   --radius:14px; --shadow:0 4px 16px rgba(34,35,34,.08);
> }
> *{box-sizing:border-box;}
> body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:radial-gradient(1100px 520px at 85% -15%,#eef6d6 0%,var(--bg) 55%);color:var(--text);min-height:100vh;}
> .topbar{display:flex;align-items:center;justify-content:space-between;padding:16px 28px;border-bottom:1px solid var(--line);background:rgba(252,255,232,.85);backdrop-filter:blur(8px);position:sticky;top:0;z-index:10;}
> .brand{display:flex;align-items:center;gap:16px;} .brand-logo{height:46px;width:auto;display:block;} .brand-sub{font-size:12px;color:var(--muted);padding-left:16px;border-left:1px solid var(--line);}
> .live-note{background:#eaf7d9;border:1px solid #bfe39a;color:#3d6b14;border-radius:10px;padding:10px 14px;font-size:12px;margin-bottom:16px;}
> .demo-banner{background:#fff3e0;border:1px solid #ffd9a0;color:#7a4a00;border-radius:10px;padding:12px 16px;font-size:13px;margin-bottom:16px;}
> .page-title{font-size:24px;font-weight:750;letter-spacing:-.4px;text-align:center;margin:4px 0 18px;}
> .section-title{font-size:16px;font-weight:700;margin:0 0 12px;} .section-title .scope{color:var(--muted);font-weight:500;}
> .platform-filter{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:20px;} .pf-label{font-size:12px;color:var(--muted);}
> .pf-chip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:999px;padding:6px 13px;font-size:13px;cursor:pointer;transition:all .12s;}
> .pf-chip .pf-dot{width:9px;height:9px;border-radius:50%;opacity:.3;} .pf-chip:hover{border-color:var(--muted);} .pf-chip.on{color:var(--text);border-color:var(--text);font-weight:600;} .pf-chip.on .pf-dot{opacity:1;}
> .controls{display:flex;align-items:center;gap:14px;} .control{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--muted);}
> .control select{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:13px;min-width:150px;}
> .cal-wrap{position:relative;} .cal-btn{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:7px 12px;font-size:13px;cursor:pointer;min-width:180px;text-align:left;font-family:inherit;} .cal-btn:hover{border-color:var(--muted);}
> .cal-pop{position:absolute;top:calc(100% + 6px);left:0;z-index:30;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);padding:12px;width:272px;}
> .cal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;} .cal-head span{font-size:13px;font-weight:650;}
> .cal-nav{border:1px solid var(--line);background:var(--panel);border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:14px;color:var(--text);} .cal-nav:hover{background:var(--panel-2);}
> .cal-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px;} .cal-dow span{text-align:center;font-size:10px;color:var(--muted);}
> .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px 0;}
> .cal-cell{border:none;background:transparent;border-radius:6px;height:30px;font-size:12px;cursor:pointer;color:var(--text);padding:0;}
> .cal-cell.empty{visibility:hidden;} .cal-cell:hover:not(.disabled):not(.sel){background:var(--panel-2);} .cal-cell.disabled{color:#c8cdbd;cursor:default;}
> .cal-cell.in-range{background:#eaf7d9;border-radius:0;} .cal-cell.range-start,.cal-cell.range-end,.cal-cell.sel{background:var(--accent);color:#fff;font-weight:650;}
> .cal-cell.range-start{border-radius:6px 0 0 6px;} .cal-cell.range-end{border-radius:0 6px 6px 0;} .cal-cell.range-start.range-end{border-radius:6px;} .cal-foot{font-size:11px;color:var(--muted);margin-top:8px;}
> .seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--panel);}
> .seg button{border:none;background:transparent;color:var(--muted);padding:7px 14px;font-size:13px;cursor:pointer;border-right:1px solid var(--line);} .seg button:last-child{border-right:none;} .seg button:hover{background:var(--panel-2);} .seg button.active{background:var(--accent);color:#fff;font-weight:600;}
> .btn{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer;} .btn:hover{background:var(--panel-2);}
> .badge{font-size:11px;padding:5px 10px;border-radius:999px;border:1px solid var(--line);color:var(--muted);} .badge.live{color:var(--good);border-color:#bfe39a;background:#eaf7d9;} .badge.demo{color:#a85f00;border-color:#ffd9a0;background:#fff3e0;}
> .dashboard{padding:24px 28px 60px;max-width:1280px;margin:0 auto;}
> .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:22px;}
> .kpi{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:18px;box-shadow:var(--shadow);}
> .kpi .label{font-size:12px;color:var(--muted);margin-bottom:8px;} .kpi-note{font-size:10px;opacity:.7;} .kpi .value{font-size:28px;font-weight:720;letter-spacing:-.5px;}
> .delta{display:inline-block;font-size:12px;margin-top:8px;} .delta.up{color:var(--good);} .delta.down{color:var(--bad);} .delta.flat{color:var(--muted);}
> .mini{font-size:11px;margin-left:6px;} .mini.up{color:var(--good);} .mini.down{color:var(--bad);}
> .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:22px;}
> .card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:18px 20px;box-shadow:var(--shadow);margin-bottom:22px;}
> .card-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px;} .card-head h2{font-size:15px;margin:0;font-weight:650;} .card-sub{font-size:12px;color:var(--muted);}
> .chart-card{margin-bottom:0;} .chart-box{position:relative;height:280px;width:100%;} .chart-note{font-size:11px;color:var(--muted);margin:10px 2px 0;line-height:1.4;} .chart-note strong{color:var(--text);}
> .table-wrap{overflow-x:auto;} .posts-table{width:100%;border-collapse:collapse;font-size:13px;}
> .posts-table th,.posts-table td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);}
> .posts-table th{color:var(--muted);font-weight:550;font-size:11px;text-transform:uppercase;letter-spacing:.4px;} .posts-table td.num,.posts-table th.num{text-align:right;font-variant-numeric:tabular-nums;}
> .posts-table tfoot .total-row td{border-top:2px solid var(--line);border-bottom:none;font-weight:700;}
> .posts-table .pill{font-size:11px;padding:3px 8px;border-radius:999px;color:#fff;} .pill.instagram{background:var(--ig);} .pill.facebook{background:var(--fb);} .pill.tiktok{background:var(--tt);} .pill.youtube{background:var(--yt);}
> .type-tag{display:inline-block;font-size:11px;color:var(--muted);background:var(--panel-2);border:1px solid var(--line);border-radius:6px;padding:2px 8px;white-space:nowrap;}
> .content-link{color:var(--text);text-decoration:none;} .content-link:hover{text-decoration:underline;color:var(--accent);}
> .content-group{margin-bottom:22px;} .cg-head{display:flex;align-items:center;gap:9px;margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid var(--line);} .cg-dot{width:11px;height:11px;border-radius:50%;} .cg-name{font-size:15px;font-weight:700;}
> .content-controls{display:flex;gap:8px;} .content-controls select{background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:6px 10px;font-size:13px;}
> .overview-card,.insight-card{border-color:var(--accent);}
> .ov-headline{font-size:14px;line-height:1.65;margin:0 0 12px;} .ov-headline strong{color:var(--text);}
> .ov-delta{font-weight:600;white-space:nowrap;} .ov-delta.up{color:var(--good);} .ov-delta.down{color:var(--bad);}
> .ov-reason{font-size:13px;background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:11px 13px;margin:0 0 14px;line-height:1.55;} .ov-reason strong{color:var(--text);}
> .ov-list{list-style:none;padding:0;margin:0;} .ov-list li{font-size:13px;padding:9px 0;border-bottom:1px solid var(--line);line-height:1.5;} .ov-list li:last-child{border-bottom:none;}
> .ov-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px;}
> .ov-sub{font-size:13px;font-weight:650;margin:6px 0;} .ov-top-list{margin:0;padding-left:20px;} .ov-top-list li{font-size:13px;padding:5px 0;line-height:1.5;} .ov-top-meta{color:var(--muted);font-size:12px;}
> .ov-fmt{list-style:none;margin:0 0 6px;padding:0;} .ov-fmt li{font-size:13px;padding:5px 0;border-bottom:1px dashed var(--line);} .ov-inactive{font-size:12px;color:var(--muted);margin:10px 0 0;}
> .chart-hint{font-size:12px;color:var(--muted);margin:2px 0 16px;}
> .insight-headline{font-size:13px;color:var(--muted);margin:0 0 6px;} .insight-value{font-size:26px;font-weight:720;}
> .spike-badge{font-size:12px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);color:var(--muted);} .spike-badge.hot{color:var(--good);background:#eaf7d9;border-color:#bfe39a;} .spike-badge.low{color:var(--bad);background:#fbeae6;border-color:#e6b8ad;}
> .loading{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(252,255,232,.7);font-size:14px;color:var(--muted);} .loading.show{display:flex;}
> @media (max-width:900px){.kpis{grid-template-columns:repeat(2,1fr);} .grid{grid-template-columns:1fr;} .controls{flex-wrap:wrap;}}
> ```
>
> ### Automation — set up the daily refresh
> After it's built and verified:
> 1. Create a **scheduled task** that re-pulls all platforms from Supermetrics and rebuilds the data files **every day at the time I gave you**, following all the same rules (organic YouTube via excluding the ADVERTISING source, first-sentence captions, and stamping "last updated" only on a successful real pull).
> 2. Tell me to open the **Scheduled** panel in the Claude sidebar and click **Run now once** to approve the Supermetrics + file-write permissions, so future runs are unattended.
> 3. Explain that the task runs **only while the Claude app is open**; if the computer is off/asleep or the app is closed at that time, it runs on next launch. For a hands-off early-morning refresh, I should keep the computer **plugged in and awake** with Claude open at that hour — on **Windows**: Settings → System → Power & battery → Screen and sleep → set "When plugged in, put my device to sleep after" to **Never** for those nights (the screen can still turn off); on **Mac**: prevent sleep when plugged in (Battery settings). Offer me a hosted/server option if I want refreshes fully independent of my computer.
>
> Confirm the dashboard renders with real data before finishing, and give me a one-line summary of the latest completed week per platform. If a platform has no data, say so plainly — never invent numbers.
