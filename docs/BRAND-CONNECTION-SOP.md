# Brand Connection SOP

This is the working SOP for connecting a new brand to the social dashboard.
Keep this document plain-language and update it whenever the process changes.

Do not paste access tokens, client secrets, refresh tokens, passwords, or
clipboard contents into this document.

## Maintenance Rule

Whenever the team connects a new brand, changes an API setup step, discovers a
new platform error, or receives new app-review feedback, update this SOP in the
same work session. Keep it as the single source of truth for future brand
connections.

## What This Process Does

The dashboard is a static website hosted on GitHub Pages. A GitHub Actions
workflow refreshes the social data, writes it into the public dashboard files,
and redeploys the site.

For each brand, the setup has four parts:

1. Confirm the brand accounts and IDs.
2. Create developer/API access with each platform.
3. Store credentials as GitHub repository secrets.
4. Run the GitHub workflow and verify the dashboard.

## Important Links

- Dashboard: https://julesdearmon.github.io/better-dog-socials-dashboard/
- GitHub repo: https://github.com/julesdearmon/better-dog-socials-dashboard
- GitHub Actions: https://github.com/julesdearmon/better-dog-socials-dashboard/actions
- GitHub repository secrets: https://github.com/julesdearmon/better-dog-socials-dashboard/settings/secrets/actions
- Meta developers: https://developers.facebook.com/
- Meta Business settings: https://business.facebook.com/settings/
- Google Cloud console: https://console.cloud.google.com/
- Google OAuth Playground: https://developers.google.com/oauthplayground/
- TikTok Developer Portal: https://developers.tiktok.com/

## GitHub Secrets

GitHub secrets are private values used by the workflow. They are not visible on
the public dashboard. Add them here:

GitHub repo -> Settings -> Secrets and variables -> Actions -> New repository secret

Use exact names. Secret names are safe to document; secret values are not.

## Meta: Instagram and Facebook

Goal: pull Instagram and Facebook Page reporting through Meta APIs.

Required access:

- Access to the brand's Meta Business portfolio.
- Access to the Facebook Page.
- The Instagram account must be connected to the Facebook Page.
- A Meta developer app connected to the same business setup.
- A system user or app token with the needed permissions.

Recommended permissions:

```text
pages_show_list
pages_read_engagement
read_insights
instagram_basic
instagram_manage_insights
```

GitHub secrets used by the dashboard:

```text
META_USER_ACCESS_TOKEN
META_PAGE_ACCESS_TOKEN
META_IG_ACCOUNT_ID
META_PAGE_ID
```

High-level steps:

1. Open Meta Business settings.
2. Confirm the brand Facebook Page and Instagram account are in the business.
3. Open Meta Developers and create or select the app for the brand.
4. Assign the app to the business/system user.
5. Generate a token with the needed permissions.
6. Add the token and account IDs to GitHub secrets.
7. Run the GitHub workflow.
8. Confirm the workflow succeeds and the dashboard updates.

Notes:

- If Meta says no permissions are available, refresh the page and confirm the
  app role/system user assignment.
- For dashboard totals, use account/page-level daily insights for the selected
  date range where available. Do not use media/post-level lifetime metrics as
  the primary total, because that only counts posts published inside the range
  and will not match Meta's native date-range reports.
- For Meta Business Suite content overview matching, target Instagram
  `content_views`/`views` and `reach`. For Facebook, target
  `page_total_media_view` for Views and `page_total_media_view_unique` for
  Viewers; show Facebook Viewers as the dashboard reach metric.
- When a Meta metric request fails, log only the metric names and the sanitized
  Meta error message. Do not log tokens or secret values. Use these logs to
  confirm whether the workflow is using account/page-level Business Suite-style
  metrics or falling back to media/post/page-profile metrics.
- If the Meta API cannot return the exact Business Suite Content Overview
  report, use `public/business-suite-overrides.js` for verified Business Suite
  totals from a screenshot or export. Keep only metric totals and date ranges in
  that file. Never add tokens, secrets, or private account access details.
- The workflow also writes API-derived weekly Meta range totals into
  `data.json` as `rangeOverrides` when Meta exposes them. The dashboard uses
  these API-derived totals before any screenshot fallback, so weekly reports can
  update automatically without manual screenshots whenever the platform API
  allows it.
- If Facebook post reporting fails with "Please reduce the amount of data
  you're asking for," use daily Page Insights for top-level totals and keep
  post-level details as best-effort only.
- Some older Facebook insight metrics may return "The value must be a valid
  insights metric." For the current dashboard fallback, request daily Page
  Insights in smaller date chunks and try `page_posts_impressions` with
  `page_posts_impressions_unique` first. Use `page_views_total` or
  `page_video_views` only as later fallbacks. If the fallback does not include
  reach, label reach as unavailable in the dashboard.
- Do not share or screenshot token values.

## YouTube

Goal: pull YouTube channel analytics and public video stats.

Required access:

- Access to the brand's YouTube channel through the Google account being used.
- A Google Cloud project.
- YouTube Data API v3 enabled.
- YouTube Analytics API enabled.
- OAuth consent screen configured.
- OAuth client credentials.

GitHub secrets used by the dashboard:

```text
YOUTUBE_CLIENT_ID
YOUTUBE_CLIENT_SECRET
YOUTUBE_REFRESH_TOKEN
YOUTUBE_CHANNEL_ID
```

High-level Google Cloud steps:

1. Open Google Cloud Console.
2. Create or select the brand project.
3. Enable YouTube Data API v3.
4. Enable YouTube Analytics API.
5. Configure OAuth consent.
6. If this is internal testing, add the channel owner's Google account as a test user.
7. Create OAuth credentials.
8. Copy the client ID and client secret.
9. Add both to GitHub secrets.

High-level OAuth Playground steps:

1. Open Google OAuth Playground.
2. Open the settings gear.
3. Check "Use your own OAuth credentials."
4. Paste the OAuth client ID and client secret.
5. Select or enter YouTube scopes.
6. Authorize using the Google account that owns or manages the channel.
7. Exchange the authorization code for tokens.
8. Copy the value from the left-side "Refresh token" field.
9. Add it to GitHub as `YOUTUBE_REFRESH_TOKEN`.

Useful scopes:

```text
https://www.googleapis.com/auth/youtube.readonly
https://www.googleapis.com/auth/yt-analytics.readonly
```

Notes:

- The refresh token is the long-lived value the workflow needs.
- The access token is short-lived and is not the value to save in GitHub.
- The dashboard excludes YouTube advertising traffic where available.

## TikTok

Goal: request read-only TikTok access so the dashboard can pull the authorized
brand account's public videos and engagement metrics.

Current status for Better Dog:

- TikTok app created.
- Site URLs verified.
- Login Kit added.
- Review video prepared.
- App submitted for review.

GitHub secrets the dashboard will need after TikTok approval:

```text
TIKTOK_CLIENT_KEY
TIKTOK_CLIENT_SECRET
TIKTOK_REFRESH_TOKEN
```

TikTok setup steps:

1. Open TikTok Developer Portal.
2. Create a new app for the brand.
3. Fill in app details.
4. Add the app icon.
5. Add Terms of Service URL.
6. Add Privacy Policy URL.
7. Select Web as the platform.
8. Add the Web/Desktop URL for the dashboard.
9. Verify the URL property.
10. Add Login Kit under Products.
11. Add the redirect URI.
12. Add scopes.
13. Upload the demo video.
14. Add a short reason for submission.
15. Submit for review.

URLs used for Better Dog:

```text
Dashboard: https://julesdearmon.github.io/better-dog-socials-dashboard/
Terms: https://julesdearmon.github.io/better-dog-socials-dashboard/terms.html
Privacy: https://julesdearmon.github.io/better-dog-socials-dashboard/privacy.html
```

Recommended TikTok review explanation:

```text
Better Dog Social Dashboard is an internal reporting dashboard used by Better
Dog Supplements and its agency team to review social media performance. We are
requesting TikTok Login Kit and TikTok API access so an authorized Better Dog
TikTok account can connect to the dashboard.

The app is used only for read-only reporting. It retrieves public TikTok video
information and engagement metrics for the authorized account, such as video
title, share URL, publish date, views, likes, comments, and shares. This data is
displayed inside the internal dashboard for performance reporting.

The app does not publish TikTok videos, edit TikTok content, send messages,
manage ads, or access data from accounts that have not authorized the app.
```

Recommended short submission reason:

```text
Requesting approval for read-only TikTok video reporting in our internal social media dashboard.
```

TikTok scopes:

```text
video.list
user.info.stats
```

If available, also select:

```text
user.info.basic
user.info.profile
```

TikTok URL verification:

1. In TikTok Developer Portal, open URL properties.
2. Add the dashboard URL as a URL-prefix property.
3. Download the verification `.txt` file.
4. Add the file to the website's `public/` folder without renaming it.
5. Commit and push the file.
6. Wait for GitHub Pages to publish it.
7. Return to TikTok and click Verify.

Notes:

- TikTok review can take time.
- TikTok may ask for changes to the demo video or app explanation.
- TikTok Display API does not expose organic reach like some reporting tools do.
  The dashboard can show views, likes, comments, shares, dates, titles, and links.

## Demo Video Guidance

Keep the demo video short, usually 2-4 minutes.

Show:

1. The dashboard homepage.
2. Date controls and metric cards.
3. Platform reporting sections.
4. Top-performing content.
5. The TikTok reporting purpose.
6. A clear statement that TikTok access is read-only.

Say:

```text
This is an internal reporting dashboard for Better Dog Supplements. We are
requesting TikTok access only to read the authorized account's public videos and
performance metrics. The app does not publish videos, edit content, send
messages, manage comments, or manage ads.
```

## Running The Refresh Workflow

After adding or updating secrets:

1. Open GitHub Actions.
2. Click "Refresh & deploy dashboard."
3. Click "Run workflow."
4. Wait for the run to finish.
5. Open the dashboard and verify the data.

If the workflow succeeds but the dashboard does not update immediately, wait a
few minutes. GitHub Pages sometimes takes extra time to publish.

## Troubleshooting

Meta shows "No permissions available":

- Refresh the page.
- Confirm the app is assigned to the system user.
- Confirm the app is connected to the correct business.

Meta says "Please reduce the amount of data you're asking for":

- Use Page Insights daily metrics for Facebook totals where possible.
- Treat Facebook post-level content as best-effort so the platform totals can
  still refresh even if the post list endpoint is limited.
- Limit the Facebook Page posts request with a `since` and `until` date.
- Send Meta date filters as Unix timestamps instead of plain date strings.
- Split long history pulls into smaller chunks, such as 30-day windows.
- Use a smaller page size, such as `limit: 25`.
- Try the lighter Facebook Page `posts` edge if `published_posts` keeps
  returning data-volume errors.
- Keep nested summaries out of the main post list request; fetch reactions and
  comments separately per post if needed.
- Retry the GitHub workflow after the request window is reduced.

Google says "Access blocked: org_internal":

- Change the OAuth audience to External or add the user to the correct Google
  organization/test users.

Google OAuth says "invalid_client":

- Confirm the client ID and client secret are from the same OAuth client.
- Confirm the value was copied completely.

Google OAuth says "invalid_grant":

- Start the OAuth Playground flow again.
- Authorization codes expire quickly and can only be used once.

TikTok says URLs are not verified:

- Add the TikTok verification file to `public/`.
- Push it to GitHub.
- Wait until the file URL is publicly accessible.
- Return to TikTok URL properties and verify again.

GitHub workflow has a Node warning:

- This is currently a warning only and does not block the dashboard deploy.

## What To Update For Each New Brand

For each new brand, update or collect:

- Brand name.
- Dashboard URL.
- Terms URL.
- Privacy URL.
- Facebook Page ID.
- Instagram Business Account ID.
- YouTube Channel ID.
- TikTok app name and app status.
- GitHub secret values.
- Demo video file.
- App review status and reviewer feedback.

Keep all secret values out of this SOP.
