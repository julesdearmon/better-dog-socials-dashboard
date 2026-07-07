# Vercel Hosting

Goal: host the Better Dog Social Dashboard on Vercel with a custom domain and a passcode gate.

Target URL:

`https://betterdog-dashboard.agmagency.com`

## Repo Setup

This repo includes:

- `vercel.json` so Vercel serves the `public/` folder.
- `middleware.ts` so the dashboard, scripts, and data files require a passcode.

The passcode is not stored in the repo. Add it in Vercel as an environment variable:

`DASHBOARD_PASSCODE`

## Vercel Project Settings

1. Vercel -> Add New -> Project.
2. Import `julesdearmon/better-dog-socials-dashboard`.
3. Framework preset: Other.
4. Build command: `pnpm run build`.
5. Output directory: `public`.
6. Environment variable: `DASHBOARD_PASSCODE`.
7. Deploy.

## Domain Setup

In Vercel, add:

`betterdog-dashboard.agmagency.com`

Then set the DNS record wherever `agmagency.com` DNS is managed:

- Type: `CNAME`
- Name: `betterdog-dashboard`
- Target: `cname.vercel-dns.com`
- Proxy: DNS only if using Cloudflare DNS

This matches the existing `dash.betterdogsupplements.com` pattern.

## Cleanup After Vercel Works

1. Confirm the Vercel URL requires the passcode.
2. Confirm `data.json` also requires the passcode.
3. Remove or ignore the Cloudflare Pages custom domain.
4. Disable the old public GitHub Pages site or make the GitHub repo private.
