# Private Dashboard Hosting

Goal: move the Better Dog dashboard to a protected Cloudflare URL and use GoHighLevel only as the branded place to link to it.

Recommended URL:

`https://betterdog-dashboard.agmagency.com`

## Cloudflare Pages

1. Cloudflare -> Workers & Pages -> Create application -> Pages -> Connect to Git.
2. Choose `julesdearmon/better-dog-socials-dashboard`.
3. Project name: `better-dog-socials-dashboard`.
4. Production branch: `main`.
5. Build command: `npm run build`.
6. Build output directory: `public`.
7. Add custom domain: `betterdog-dashboard.agmagency.com`.

The repo includes `wrangler.toml`, so Cloudflare can also detect the output folder as `public`.

## Cloudflare Access

1. Cloudflare -> Zero Trust -> Access -> Applications -> Add an application.
2. Choose Self-hosted.
3. Application domain: `betterdog-dashboard.agmagency.com`.
4. Policy: Allow only approved emails.
5. Authentication: One-time PIN is simplest.
6. Also protect the default Cloudflare Pages URL, or redirect it to the custom domain.

Do not rely on GoHighLevel alone for protection. If the dashboard URL itself is public, people can bypass the portal.

## GoHighLevel

In the Better Dog Supplements sub-account, add a Client Portal or custom menu link:

Label: `Social Dashboard`

URL: `https://betterdog-dashboard.agmagency.com`

## Important cleanup

The GitHub repository is currently public. For real privacy:

1. Make `julesdearmon/better-dog-socials-dashboard` private.
2. Disable the current GitHub Pages site or remove the `gh-pages` branch after Cloudflare is live.
3. Confirm this public URL no longer exposes the dashboard:
   `https://julesdearmon.github.io/better-dog-socials-dashboard/`

Until those cleanup steps are done, Cloudflare Access will protect the new URL, but the old public GitHub URL may still be reachable.
