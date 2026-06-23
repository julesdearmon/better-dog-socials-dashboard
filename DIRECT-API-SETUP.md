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

Required secrets:

```text
META_ACCESS_TOKEN
META_IG_ACCOUNT_ID
META_PAGE_ID
```

Better Dog defaults already built into the script:

```text
META_IG_ACCOUNT_ID=17841475238822164
META_PAGE_ID=674626722402999
```

If those IDs stay the same, only `META_ACCESS_TOKEN` is strictly required.

The Meta app needs access to the Better Dog Facebook Page and connected
Instagram Business/Creator account. For production-like access, expect to need
Meta app review for page and Instagram insight permissions.

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

Required secrets:

```text
TIKTOK_CLIENT_KEY
TIKTOK_CLIENT_SECRET
TIKTOK_REFRESH_TOKEN
```

The fast internal TikTok integration uses the Display API / Login Kit
`video.list` endpoint. That endpoint gives public video posts plus fields like
views, likes, comments, shares, title, and share URL.

Important limitation: TikTok Display API does not expose organic reach in the
same way Supermetrics currently does, so the direct TikTok connector marks
TikTok reach as unavailable. Views and engagement remain available.

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
- TikTok: direct Display API does not expose reach. We should revisit TikTok
  Business/Marketing API access if TikTok reach is a hard requirement.

