# Social Media Dashboard — Reusable Build Prompt

Hand this to **Claude Code** to build an organic social-media metrics dashboard for any brand,
modeled on the Better Dog Supplements dashboard. Fill in the bracketed `{{PLACEHOLDERS}}`,
then paste the whole "PROMPT TO PASTE" section into Claude Code.

---

## 1. Before you start (one-time setup)

- **Claude Code** (desktop app), with the **Supermetrics connector** added and authorized.
- In Supermetrics (hub.supermetrics.com), connect the brand's accounts for each platform you want:
  **Instagram Insights, Facebook Insights (Page), YouTube, TikTok Organic.**
  - TikTok and Instagram must be **Business/Creator** accounts or they return no data.
  - Connect the *exact* brand accounts (not a personal/agency account).
- **Node.js** installed (used to write the data files). If the machine has no Node, tell Claude — it can
  often use a Node that ships with other apps.
- Have ready: the brand's **handles**, **brand colors** (hex), and a **logo** image file.

## 2. Fill these in

```
{{BRAND_NAME}}        = e.g. "Acme Coffee Co."
{{BRAND_SHORT}}       = short name for headlines, e.g. "Acme"
{{BRAND_COLOR}}       = primary hex, e.g. "#88cc33"
{{ACCENT_COLOR}}      = secondary hex, e.g. "#ffa630"
{{LOGO_PATH}}         = path to a logo image, or "none"
{{TIMEZONE}}          = e.g. "America/New_York"
{{PLATFORMS}}         = which of: Instagram, Facebook, YouTube, TikTok
{{IG_HANDLE}}         = @handle (or "skip")
{{FB_PAGE}}           = page name/URL (or "skip")
{{YT_CHANNEL}}        = channel name/URL (or "skip")
{{TIKTOK_HANDLE}}     = @handle (or "skip")
{{REFRESH_TIME}}      = daily auto-refresh time, e.g. "6:00 AM"
{{ADS_SETUP}}         = "separate ad creatives" OR "we boost organic posts" OR "no ads"
```

> **Why {{ADS_SETUP}} matters:** if ads are *separate creatives* (run in Ads Manager, not boosting
> posts), Instagram/Facebook post metrics are already organic. If you *boost organic posts*, paid
> leaks into those posts and Instagram can't be cleanly separated via Supermetrics — flag that to the client.

---

## 3. PROMPT TO PASTE INTO CLAUDE CODE

> Build a single-brand **organic** social-media metrics dashboard for **{{BRAND_NAME}}**, covering these platforms: **{{PLATFORMS}}**. Accounts: Instagram {{IG_HANDLE}}, Facebook {{FB_PAGE}}, YouTube {{YT_CHANNEL}}, TikTok {{TIKTOK_HANDLE}}. My ad setup is: **{{ADS_SETUP}}**.
>
> **Data source — use the Supermetrics MCP, and never fabricate numbers.** Use the discovery tools to find the right IDs and fields for THIS brand (do not assume mine): `data_source_discovery`, `accounts_discovery`, `field_discovery`, then `data_query` + `get_async_query_results` (compress=true, custom date ranges, poll until complete). If a platform/account isn't connected or returns no data, tell me and continue with the others — don't invent values.
>
> **Metrics & definitions:**
> - Track **Views** and **Reach**, plus **Watch time** for YouTube only. Also track **post count**, but treat it as a *contributing factor*, not a headline metric — order metrics as **Views, Reach, Watch time, Posts (last)**.
> - Per platform, bucket each post's lifetime views/reach by its **post/creation date** (Instagram, Facebook, TikTok). For TikTok use the **videos** report. YouTube has **no reach** metric — exclude it from reach everywhere and show "—".
> - **ORGANIC ONLY:**
>   - **YouTube:** pull views & watch time from the **TrafficSources** report and **exclude the `ADVERTISING` traffic source** (YouTube video ads otherwise inflate views heavily). Use LatestVideos for post counts.
>   - **Instagram & Facebook:** if my ad setup is "separate ad creatives," the post-level metrics are already organic — no change. If I "boost organic posts," note that paid leaks into those posts and Instagram can't be split via Supermetrics; flag it.
>   - Add a visible "Organic only" note on the dashboard explaining this.
> - Pull captions and use the **first sentence** of each caption as the post title (Instagram media_caption, Facebook post_message, TikTok video caption; YouTube uses its real video title).
>
> **Output format:** a static dashboard (vanilla HTML/CSS/JS + Chart.js) that opens by double-clicking a local file. Because browsers block `fetch()` of local files, embed the data in a `realdata.js` file as `window.REAL_DATA = {…}` (also write a `data.json`). Brand it with primary color **{{BRAND_COLOR}}**, accent **{{ACCENT_COLOR}}**, and logo **{{LOGO_PATH}}**. **Match the design in the companion file `DASHBOARD-DESIGN-AND-AUTOMATION.md` — reuse that `styles.css` and change only the `:root` brand colors and the logo.**
>
> **Features:**
> 1. A platform selector ("Show:") with **All Platforms**, one chip per platform, and **Total** — clicking shows only that line.
> 2. A **custom date range** via a click-to-highlight calendar (click a start day, then an end day), plus quick presets: **Last week, Last 4 weeks, Last month, Last 3 months**.
> 3. A **Daily / Weekly / Monthly** toggle that controls how the trend charts are grouped (weeks run Friday→Thursday). Default to weekly.
> 4. **KPI tiles** that total over the selected date range and compare to the **equal-length window immediately before** it (show up/down %, green up / red down).
> 5. **Trend charts** for each metric; clicking a point shows a small **"Data insights"** panel explaining that point (top posts that period, how it compares to the average) — data only.
> 6. An **"Overall analysis"** card that is **100% data-derived (never invented)** and adapts wording to the selection ("Month of …", "Week of …", or a custom range, "vs the previous month/week/period"). It should:
>    - give a plain-language headline of views/reach for the range with up/down %,
>    - decompose **what contributed** to the change (more/fewer posts vs higher/lower views-per-post vs a single breakout post),
>    - show **engagement rate** and **average views per post**,
>    - rank **what's working by format** (content type → avg views), and
>    - list the **top posts** as clickable links.
>    Keep it readable and simple; **don't use em dashes**; **bold each platform name only once** (at the start of its line).
> 7. A **Top Performing Content** section (top posts per platform, with type, date, views, reach, engagement, linked).
> 8. A header note: **"Live data through &lt;last data date&gt; · last updated &lt;timestamp&gt;"**, where "last updated" is stamped **only when real data is actually pulled** (never on code edits).
>
> **Automation:** create a scheduled task that re-pulls all platforms and rebuilds the data files **daily at {{REFRESH_TIME}} ({{TIMEZONE}})**, following the same rules above. It must re-pull captions and keep YouTube organic.
>
> Confirm everything renders with real data before finishing, and give me a one-line summary of the latest completed week per platform.

---

## 4. Notes / gotchas to pass along

- **Organic-only is the whole point** of this dashboard — double-check the YouTube "Advertising" exclusion, since YouTube ads can be the majority of raw views.
- TikTok Organic only reaches back ~60 days for date-bounded queries, but its "videos" report still returns older posts.
- The "last updated" timestamp should reflect a **real Supermetrics pull**, not file edits.
- If no platform data appears, the dashboard should clearly say so (and fall back to a sample/demo) rather than show fake numbers.
- Known limitation: YouTube per-video view counts in "top content" can still include ad views unless you also split each video by traffic source.
- For the **look** and for **auto-refresh + keeping the computer awake**, see the companion file `DASHBOARD-DESIGN-AND-AUTOMATION.md`.
