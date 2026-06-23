'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');

const connectors = require('./connectors');

const app = express();
const PORT = process.env.PORT || 4000;

// ---------------------------------------------------------------------------
// Load client config
// ---------------------------------------------------------------------------
const clientsPath = path.join(__dirname, 'config', 'clients.json');
function loadClients() {
  const raw = fs.readFileSync(clientsPath, 'utf8');
  return JSON.parse(raw).clients;
}

// "As of" date — pinned so demo data is reproducible. Override with ?now=ISO.
const DEFAULT_NOW = Date.parse('2026-06-16T00:00:00Z');

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------------------------
// API: list clients (for the switcher)
// ---------------------------------------------------------------------------
app.get('/api/clients', (req, res) => {
  try {
    const clients = loadClients().map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      platforms: Object.keys(c.accounts)
    }));
    res.json({ clients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// API: daily metrics for one client, across all (or selected) platforms
//   GET /api/metrics/:clientId?days=400&platforms=instagram,youtube
//
// Each platform returns a trailing daily series:
//   { daily: [{ date, posts, views, reach, watchTime }] }  (oldest first)
// The frontend aggregates this into Daily / Weekly (Fri–Thu) / Monthly periods
// and computes period-over-period deltas.
// ---------------------------------------------------------------------------
app.get('/api/metrics/:clientId', async (req, res) => {
  try {
    const client = loadClients().find((c) => c.id === req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Unknown client' });

    const days = Math.min(800, Math.max(14, parseInt(req.query.days, 10) || 400));
    const now = req.query.now ? Date.parse(req.query.now) : DEFAULT_NOW;

    const requested = req.query.platforms
      ? String(req.query.platforms).split(',').map((s) => s.trim())
      : connectors.PLATFORMS;

    const platforms = requested.filter(
      (p) => connectors.PLATFORMS.includes(p) && client.accounts[p]
    );

    const results = await Promise.all(
      platforms.map(async (platform) => {
        const account = client.accounts[platform];
        try {
          const data = await connectors.fetchMetrics(platform, {
            clientId: client.id,
            account,
            days,
            now
          });
          return [platform, data];
        } catch (err) {
          // One platform failing shouldn't blank the whole dashboard.
          return [platform, { platform, handle: account.handle, error: err.message, source: 'error', daily: [] }];
        }
      })
    );

    res.json({
      client: { id: client.id, name: client.name, color: client.color },
      days,
      asOf: new Date(now).toISOString().slice(0, 10),
      metrics: Object.fromEntries(results)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health/info endpoint — shows which platforms are running live vs demo.
app.get('/api/status', (req, res) => {
  const liveMode = process.env.USE_DEMO_DATA !== 'true';
  res.json({
    ok: true,
    demoMode: !liveMode,
    credentials: {
      meta: !!process.env.META_ACCESS_TOKEN,
      youtube: !!process.env.YOUTUBE_API_KEY
    }
  });
});

app.listen(PORT, () => {
  const demo = process.env.USE_DEMO_DATA === 'true';
  console.log(`\n  Better Dog Supplements — Social Dashboard running at  http://localhost:${PORT}`);
  console.log(`  Mode: ${demo ? 'DEMO data (no API keys needed)' : 'LIVE where credentials exist, demo otherwise'}\n`);
});
