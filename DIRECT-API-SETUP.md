# Direct API Setup

This is the fast internal setup for pulling Better Dog dashboard data directly
from the social platforms, without Supermetrics.

The live site stays static on GitHub Pages. GitHub Actions runs
`scripts/build-data-direct.mjs` each morning, calls the platform APIs with
secrets stored in GitHub, rewrites `public/data.json` and `public/realdata.js`,
then deploys the site.

Supermetrics remains as a fallback while the direct credentials are being added.
If no direct secrets exist, the workflow uses `SUPERMETRICS_API_KEY`; if neither
source exists, it deploys the committed seed data.

## GitHub Secrets

Add these in GitHub:

Repository -> Settings -> Secrets and variables -> Actions -> New repository secret

### Meta: Instagram + Facebook

Recommended secrets:

```text
META_USER_ACCESS_TOKEN
META_PAGE_ACCESS_TOKEN
META_IG_ACCOUNT_ID
META_PAGE_ID
```

`META_USER_ACCESS_TOKEN` is used for Instagram Graph API calls.
`META_PAGE_ACCESS_TOKEN` is used for Facebook Page post and insight calls.
If you only add `META_USER_ACCESS_TOKEN`, the builder will try to derive the
page access token from the page ID.

Legacy fallback:

```text
META_ACCESS_TOKEN
```

The script still accepts `META_ACCESS_TOKEN` so we can test quickly with a
single token, but the two-token setup is cleaner for the agency version.

Better Dog defaults already built into the script:

```text
META_IG_ACCOUNT_ID=17841475238822164
META_PAGE_ID=674626722402999
```

If those IDs stay the same, the ID secrets are optional.

The Meta app needs access to the Better Dog Facebook Page and connected
Instagram Business/Creator account. For production-like access, expect to need
Meta app review for page and Instagram insight permissions.

Minimum Meta permissions to request for the fast internal dashboard:

```text
pages_show_list
pages_read_engagement
read_insights
instagram_basic
instagram_manage_insights
```

Useful docs:

- https://developers.facebook.com/docs/instagram-platform/
- https://developers.facebook.com/docs/graph-api/

### YouTube

Required secrets:

```text
YOUTUBE_CLIENT_ID
YOUTUBE_CLIENT_SECRET
YOUTUBE_REFRESH_TOKEN
YOUTUBE_CHANNEL_ID
```

Better Dog default already built into the script:

```text
YOUTUBE_CHANNEL_ID=UC9rUabwMqe2C98J2l1NDz2g
```

If that channel ID stays the same, the three OAuth secrets are the required
pieces. Enable both YouTube Data API v3 and YouTube Analytics API in the Google
Cloud project.

The builder uses YouTube Analytics traffic-source data and excludes
`ADVERTISING` so YouTube views and watch time stay organic.

Useful docs:

- https://developers.google.com/youtube/analytics/reference/reports/query
- https://developers.google.com/youtube/v3

### TikTok

Preferred path: TikTok API for Business / Organic API.

The regular TikTok for Developers app review was rejected for this dashboard
because TikTok does not approve personal/company-internal dashboard use through
that developer product. Use the Business API portal instead:

- https://business-api.tiktok.com/portal
- Organic API docs: https://business-api.tiktok.com/portal/docs/organic-api/v1.3

Required Business API secrets:

```text
TIKTOK_BUSINESS_ACCESS_TOKEN
TIKTOK_BUSINESS_ID
```

The direct builder now prefers TikTok Business/Organic API when those two
secrets are present. It calls TikTok's business video list endpoint and maps
video/post views, engagement, post date, URL, and reach when TikTok returns it.
If the Business API app is not approved yet, leave these blank; the dashboard
will keep TikTok marked pending and excluded from totals.

Legacy fallback only:

```text
TIKTOK_CLIENT_KEY
TIKTOK_CLIENT_SECRET
TIKTOK_REFRESH_TOKEN
```

These are for the TikTok for Developers Display API / Login Kit `video.list`
endpoint. TikTok rejected that path for the internal reporting dashboard, so it
should only be used if TikTok explicitly approves a future public-facing use
case.

TikTok access tokens expire quickly and are refreshed using the refresh token.
TikTok may rotate refresh tokens; if the workflow log warns that it returned a
new refresh token, update the `TIKTOK_REFRESH_TOKEN` secret.

Useful docs:

- https://developers.tiktok.com/doc/tiktok-api-v2-video-list
- https://developers.tiktok.com/doc/oauth-user-access-token-management

## Testing One Platform At A Time

You do not need every platform connected before testing.

1. Add the secrets for one platform.
2. Go to Actions -> Refresh & deploy dashboard -> Run workflow.
3. Open the run log.
4. Confirm the platform prints `OK`.

The script carries forward old data for platforms that are not configured yet,
so the public dashboard will not go blank during migration.

## Local Test

If Node is available:

```bash
node scripts/build-data-direct.mjs
```

On this Windows machine, Node is available through Adobe:

```powershell
& "C:\Program Files\Adobe\Adobe Photoshop 2026\node.exe" scripts\build-data-direct.mjs
```

Set the needed environment variables first.

## Accuracy Notes

- Instagram: post metrics are bucketed by publish date, matching the current
  dashboard behavior. The connector tries current Meta metrics first and falls
  back to older equivalents where needed.
- Facebook: video posts use video views when available; otherwise the connector
  uses post impressions as the closest all-post "views" equivalent.
- YouTube: daily views/watch time are channel analytics by traffic source, with
  advertising excluded. Per-video top-content stats come from video statistics.
- TikTok: use the Business/Organic API path for the internal dashboard. TikTok
  for Developers / Display API is retained only as a legacy fallback.
