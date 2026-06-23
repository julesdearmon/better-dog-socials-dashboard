'use strict';

/**
 * Browser-side demo data (DAILY base series) — mirror of
 * server/connectors/demoData.js. Lets the dashboard render with realistic mock
 * data when no Node backend is running. app.js falls back to this if /api is
 * unreachable, and aggregates the daily series into Daily/Weekly/Monthly.
 */
window.DEMO = (function () {
  const CLIENTS = [
    {
      id: 'better-dog-supplements', name: 'Better Dog Supplements', color: '#88cc33',
      accounts: {
        instagram: '@betterdogsupplements', facebook: 'Better Dog Supplements',
        tiktok: '@betterdogsupplements', youtube: 'Better Dog Supplements'
      }
    }
  ];

  const PROFILE = {
    instagram: { postsPerWeek: 5, weeklyViews: 62000, reachRatio: 0.66, watch: false, avgViewMin: 0 },
    facebook:  { postsPerWeek: 4, weeklyViews: 26000, reachRatio: 0.72, watch: false, avgViewMin: 0 },
    tiktok:    { postsPerWeek: 7, weeklyViews: 230000, reachRatio: 0.58, watch: false, avgViewMin: 0 },
    youtube:   { postsPerWeek: 2, weeklyViews: 48000, reachRatio: 0.45, watch: true,  avgViewMin: 2.6 } // reach = unique viewers (< views)
  };

  const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube'];
  const NOW = Date.parse('2026-06-16T00:00:00Z');
  const DAY = 86400000;

  function hashString(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generate(platform, clientId, handle, days) {
    const p = PROFILE[platform] || PROFILE.instagram;
    const rand = mulberry32(hashString(`${clientId}:${platform}:${handle}`));
    const lastComplete = NOW - DAY;
    const scale = 0.6 + rand() * 1.8;
    const dailyGrowth = (0.004 + rand() * 0.03) / 7;
    const perDay = p.postsPerWeek / 7;
    let running = (p.weeklyViews / 7) * scale * 0.82;

    const daily = [];
    for (let i = days - 1; i >= 0; i--) {
      const dms = lastComplete - i * DAY;
      const date = new Date(dms).toISOString().slice(0, 10);
      const dow = new Date(dms).getUTCDay();
      const growth = dailyGrowth + (rand() - 0.5) * 0.01;
      running = Math.max(0, running * (1 + growth));
      const viral = rand() < 0.03;
      const weekend = dow === 0 || dow === 6 ? 0.85 : 1;
      const views = Math.round(running * (0.7 + rand() * 0.6) * weekend * (viral ? 2.6 : 1));
      const reach = Math.round(views * p.reachRatio * (0.9 + rand() * 0.2));
      let posts = 0;
      if (rand() < Math.min(0.97, perDay)) posts = 1;
      if (perDay > 1 && rand() < perDay - 1) posts += 1;
      const watchTime = p.watch ? Math.round(views * p.avgViewMin * (0.85 + rand() * 0.3)) : null;
      daily.push({ date, posts, views, reach, watchTime });
    }

    return { platform, handle, source: 'demo', hasWatchTime: !!p.watch, asOf: new Date(NOW).toISOString().slice(0, 10), daily };
  }

  function clients() {
    return { clients: CLIENTS.map((c) => ({ id: c.id, name: c.name, color: c.color, platforms: PLATFORMS })) };
  }

  function metrics(clientId, days) {
    const client = CLIENTS.find((c) => c.id === clientId) || CLIENTS[0];
    const m = {};
    for (const p of PLATFORMS) m[p] = generate(p, client.id, client.accounts[p], days);
    return {
      client: { id: client.id, name: client.name, color: client.color },
      days, asOf: new Date(NOW).toISOString().slice(0, 10), metrics: m
    };
  }

  return { clients, metrics };
})();
