# Agency Version Roadmap

The fast internal version is intentionally simple: one brand, platform tokens in
GitHub Secrets, and a daily GitHub Actions refresh.

The agency version should keep the same dashboard UI and data schema, but move
authentication and refresh orchestration into a reusable backend.

## Target Architecture

```text
Client browser
  -> Dashboard UI
  -> Agency API
      -> OAuth connect flows
      -> Encrypted token storage
      -> Scheduled refresh workers
      -> Normalized metrics database
      -> Static/client-safe reporting JSON
```

## Core Product Pieces

1. Client registry
   - Client name, brand colors, logo, timezone, reporting week rules.
   - Platform account mappings per client.

2. OAuth connect center
   - "Connect Instagram/Facebook"
   - "Connect YouTube"
   - "Connect TikTok"
   - Status badges for connected, expiring, disconnected, needs review.

3. Token vault
   - Store access and refresh tokens encrypted.
   - Rotate and refresh tokens automatically.
   - Audit who connected or reconnected each account.

4. Data refresh workers
   - Scheduled daily jobs per client.
   - Retry and partial-failure handling per platform.
   - Store raw API responses or normalized snapshots for auditability.

5. Normalized metrics layer
   - Keep the current `metrics[platform].daily[]` shape as the public contract.
   - Store metadata explaining metric limitations, such as TikTok reach
     unavailable or YouTube reach excluded.

6. Dashboard publishing
   - Option A: one hosted app with client routes.
   - Option B: generate static client dashboards to Pages/S3/Cloudflare.
   - Option C: private client portal with authentication.

## Why This Matters Later

The agency version removes the biggest limits of the fast internal setup:

- No GitHub Secret per client/platform.
- No manual token updates for rotated refresh tokens.
- Cleaner onboarding for new clients.
- Better access control for client-specific reporting.
- Centralized monitoring when a platform token expires or an API changes.

## Migration Path

1. Finish Better Dog direct APIs with the fast internal setup.
2. Extract each platform puller into reusable modules.
3. Add a small database for clients, accounts, tokens, refresh runs, and
   normalized daily metrics.
4. Build OAuth callback endpoints and a simple admin screen.
5. Move GitHub Actions refresh logic into backend scheduled workers.
6. Keep exporting the same dashboard JSON so the current UI does not need a
   rewrite.

## Recommended Stack Later

- Backend: Node/Express or Next.js API routes.
- Database: Postgres.
- Token encryption: managed secret key in the hosting provider.
- Scheduler: provider cron, GitHub Actions calling a protected endpoint, or a
  worker queue.
- Hosting: Render/Fly/Heroku/Vercel for backend; GitHub Pages, Cloudflare Pages,
  or S3/CloudFront for static dashboard output.

