# Connecting real social media data

The dashboard runs on **demo data out of the box**. To pull live metrics, you
register a developer app with each platform, get an access token, and paste it
into your `.env` file. Then set the `id` for each account in
`server/config/clients.json`.

> ⚠️ Important reality check: there is **no legitimate way** to read these
> metrics without going through each platform's official API. Scraping public
> pages violates their terms of service, breaks constantly, and can get accounts
> banned. The steps below are the supported path agencies actually use. Several
> require your **client to grant you access** to their account/page, and some
> require the platform to **review and approve** your app (days to weeks).

After adding any real credentials, set `USE_DEMO_DATA=false` in `.env`. Any
platform still missing credentials automatically stays on demo data, so you can
go live one platform at a time.

---

## 1. Instagram + Facebook (Meta Graph API)

One Meta app covers both. This is the biggest setup but unlocks two platforms.

1. Go to <https://developers.facebook.com> → **My Apps** → **Create App** →
   type **Business**.
2. Add the **Instagram Graph API** and **Facebook Login** products.
3. Your client's Instagram must be a **Business or Creator account** that is
   **linked to a Facebook Page**. (Agency standard: have the client add your
   Business Manager as a partner with access to the Page + IG account.)
4. Request these permissions (App Review required to use them on accounts you
   don't own): `instagram_basic`, `instagram_manage_insights`,
   `pages_read_engagement`, `pages_show_list`, `read_insights`.
5. Generate a **long-lived Page access token** (Graph API Explorer → get a User
   token → exchange for long-lived → get the Page token). Long-lived Page
   tokens don't expire as long as the user stays connected.
6. Find the IDs:
   - **Page ID**: on the Page → About, or via `GET /me/accounts`.
   - **Instagram Business Account ID**: `GET /{page-id}?fields=instagram_business_account`.

Put in `.env`:
```
META_APP_ID=...
META_APP_SECRET=...
META_ACCESS_TOKEN=<long-lived page token>
```
Put the IDs in `clients.json`:
```json
"instagram": { "handle": "@acme.co", "id": "<ig business account id>" },
"facebook":  { "handle": "Acme Co.", "id": "<page id>" }
```

Connector files: `server/connectors/instagram.js`, `server/connectors/facebook.js`

---

## 2. YouTube

1. Go to <https://console.cloud.google.com> → create a project.
2. Enable **YouTube Data API v3** and **YouTube Analytics API**.
3. Create an **API key** (for public channel stats) and an **OAuth 2.0 client**
   (for the Analytics API — watch time, subscribers gained over time).
4. The channel owner authorizes the OAuth client → you get an access token.
5. Get the **channel ID** (starts with `UC...`): YouTube Studio → Settings →
   Channel → Advanced, or `GET /channels?part=id&forHandle=@handle`.

Put in `.env`:
```
YOUTUBE_API_KEY=...
YOUTUBE_ACCESS_TOKEN=<oauth token, optional but needed for daily trends>
```
Put the channel ID in `clients.json`:
```json
"youtube": { "handle": "Acme Co.", "id": "UCxxxxxxxxxxxxxxxx" }
```
Connector: `server/connectors/youtube.js`

---

## Token expiry & refresh

- **Meta** long-lived Page tokens: effectively long-lived; re-auth if the user
  changes their password or removes the app.
- **YouTube/Google**: OAuth access tokens expire in ~1 hour; use the refresh
  token to renew.

For a production agency setup you'd store refresh tokens per client and renew
automatically. The current connectors read a static token from `.env` — fine
for getting started and for Meta. When you're ready to automate refresh, that
logic goes in each connector's `getJson`/`postJson` helper.
