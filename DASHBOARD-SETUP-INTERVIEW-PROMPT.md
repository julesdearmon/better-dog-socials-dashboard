# Social Media Dashboard — Guided Setup Prompt (interview style)

Give this to someone who wants their own organic social dashboard. They paste the
**"PROMPT TO PASTE"** block below into **Claude Code** (with the Supermetrics connector available),
and Claude walks them through connecting accounts and answering a few questions one at a time,
then builds it. No placeholders to fill in — Claude asks.

---

## PROMPT TO PASTE INTO CLAUDE CODE

> You're going to help me build an **organic** social-media metrics dashboard for **one brand**, using the **Supermetrics MCP connector** for real data. Do this with me interactively: **ask me ONE question at a time and wait for my answer before asking the next.** Keep it friendly and non-technical. **Never fabricate or estimate data** — only use real values from Supermetrics; if something isn't connected, tell me and help me fix it.
>
> **STEP 1 — Connect the brand's accounts in Supermetrics first (before anything else).**
> Walk me through this and don't move on until it's done:
> 1. Tell me to open the **Supermetrics connector** / sign in at **hub.supermetrics.com** (token management).
> 2. For each platform I want, connect the **brand's own account**: **Instagram Insights, Facebook Page Insights, YouTube, TikTok Organic.**
> 3. Remind me that **Instagram and TikTok must be Business/Creator accounts** (personal accounts return no data), and to connect the **exact brand accounts**, not a personal or agency account.
> 4. Once I say I've connected them, run `data_source_discovery` and `accounts_discovery` and show me which accounts you can actually see for each platform. If one I expect is missing or looks wrong, help me reconnect it. Only continue once I confirm the correct accounts are connected.
>
> **STEP 2 — Interview me one question at a time** (ask, wait, confirm, then next):
> 1. What's the brand name? (and a short version for headlines)
> 2. Which platforms should it cover — Instagram, Facebook, YouTube, and/or TikTok?
> 3. For each platform I picked, which handle/account is it? (Match it to what you saw in Supermetrics in Step 1.)
> 4. How do we run ads: **separate ad creatives** in Ads Manager, **boosting organic posts**, or **no ads**? (This decides how I keep the numbers organic — explain the difference if I'm unsure.)
> 5. Brand colors: primary and accent (hex codes)? And a logo image (file path) or none?
> 6. What time zone are we in, and what time each day should the dashboard auto-refresh?
> 7. Anything specific you want the analysis to emphasize?
>
> **STEP 3 — Verify, then build.** Re-pull a small sample for each connected platform to confirm real data comes back, and tell me what you found. Then build the dashboard.
>
> **What to build** — a single-brand **organic** social dashboard, as static HTML/CSS/vanilla-JS + Chart.js that opens by double-clicking a local file (embed the data in a `realdata.js` as `window.REAL_DATA = {…}` since browsers block local `fetch()`; also write `data.json`). Branded with my colors + logo. **Match the visual design in the companion file `DASHBOARD-DESIGN-AND-AUTOMATION.md` — reuse that `styles.css` as the baseline and change only the brand colors and logo.** Requirements:
> - **Metrics:** Views and Reach, plus Watch time for YouTube only; also track post count but show it last (order: Views, Reach, Watch time, Posts). Bucket each post's lifetime views/reach by its post date (Instagram/Facebook/TikTok). YouTube has no reach — exclude it from reach and show "—".
> - **Organic only:** For **YouTube**, pull views & watch time from the **TrafficSources** report and **exclude the `ADVERTISING` source** (ads can be the majority of YouTube views). For **Instagram/Facebook**, if ads are *separate creatives* the post metrics are already organic (no change); if we *boost posts*, tell me paid leaks in and Instagram can't be cleanly split. Put a visible **"Organic only"** note on the dashboard.
> - Use the **first sentence of each post's caption** as its title (YouTube uses its real video title).
> - **Controls:** a platform selector ("Show:" → All Platforms / each platform / Total); a **click-to-highlight calendar** date range plus quick presets (Last week / 4 weeks / month / 3 months); a Daily/Weekly/Monthly grouping toggle (weeks = Friday→Thursday).
> - **KPI tiles** that total over the selected range and compare to the equal-length window right before it (up/down %, green up / red down).
> - **Trend charts** with a click-a-point "Data insights" popover (data only).
> - An **"Overall analysis"** card that is **100% data-derived, never invented**, adapts wording to the selection (Month/Week/range, "vs the previous …"), decomposes **what contributed** to the change (more/fewer posts vs higher/lower views-per-post vs a breakout post), shows engagement rate and avg views/post, ranks **what's working by content format**, and lists **top posts as clickable links**. Readable, **no em dashes**, bold each platform name only once.
> - A **Top Performing Content** section (top posts per platform: type, date, views, reach, engagement, linked).
> - A header note **"Live data through &lt;date&gt; · last updated &lt;timestamp&gt;"** where "last updated" is stamped **only when real data is actually pulled.**
> - **Automation:** a scheduled task that re-pulls everything and rebuilds the data files **daily at the time I gave you**, following all the same rules (organic YouTube, captions, etc.).
>
> Confirm it renders with real data before finishing, and give me a one-line summary of the latest completed week per platform. If any platform has no data, say so plainly instead of inventing numbers.
>
> After it's built, walk me through **Parts B & C of `DASHBOARD-DESIGN-AND-AUTOMATION.md`**: approving the scheduled task's permissions once (Run now), and keeping my computer on/awake with the Claude app open at the refresh time so it actually runs.
