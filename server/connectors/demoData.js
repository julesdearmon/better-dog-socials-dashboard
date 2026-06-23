'use strict';

/**
 * Realistic demo-data generator (DAILY base series).
 *
 * Returns a daily series per platform:
 *   { platform, handle, source, hasWatchTime, asOf,
 *     daily: [ { date:'YYYY-MM-DD', posts, views, reach, watchTime } ] }
 *
 * The frontend aggregates this daily series into Daily / Weekly (Fri–Thu) /
 * Monthly periods on the fly, so the toggle is instant and the numbers stay
 * consistent across granularities. watchTime (minutes) is YouTube-only (null
 * elsewhere). Numbers are seeded from brand + platform so they're stable.
 */

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
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Per-platform baselines (weekly), converted to daily below.
const PROFILE = {
  instagram: { postsPerWeek: 5, weeklyViews: 62000, reachRatio: 0.66, watch: false, avgViewMin: 0 },
  facebook:  { postsPerWeek: 4, weeklyViews: 26000, reachRatio: 0.72, watch: false, avgViewMin: 0 },
  tiktok:    { postsPerWeek: 7, weeklyViews: 230000, reachRatio: 0.58, watch: false, avgViewMin: 0 },
  youtube:   { postsPerWeek: 2, weeklyViews: 48000, reachRatio: 0.45, watch: true,  avgViewMin: 2.6 } // reach = unique viewers (< views)
};

const DAY = 86400000;

/**
 * @param {object} o
 * @param {string} o.platform   instagram|facebook|tiktok|youtube
 * @param {string} o.clientId
 * @param {string} o.handle
 * @param {number} o.days        number of trailing days to generate (default 400 ≈ 13 months)
 * @param {number} o.now         epoch ms "as of" date (so output is stable)
 */
function generate({ platform, clientId, handle, days = 400, now }) {
  const p = PROFILE[platform] || PROFILE.instagram;
  const rand = mulberry32(hashString(`${clientId}:${platform}:${handle}`));
  const asOf = now || Date.parse('2026-06-16T00:00:00Z');
  const lastComplete = asOf - DAY; // yesterday is the most recent complete day

  const scale = 0.6 + rand() * 1.8;
  const dailyGrowth = (0.004 + rand() * 0.03) / 7; // weekly trend spread over 7 days
  const perDay = p.postsPerWeek / 7;
  let running = (p.weeklyViews / 7) * scale * 0.82; // start a bit below "today"

  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const dms = lastComplete - i * DAY;
    const date = new Date(dms).toISOString().slice(0, 10);
    const dow = new Date(dms).getUTCDay();

    const growth = dailyGrowth + (rand() - 0.5) * 0.01;
    running = Math.max(0, running * (1 + growth));

    const viral = rand() < 0.03;
    const weekend = dow === 0 || dow === 6 ? 0.85 : 1; // mild weekday seasonality
    const views = Math.round(running * (0.7 + rand() * 0.6) * weekend * (viral ? 2.6 : 1));
    const reach = Math.round(views * p.reachRatio * (0.9 + rand() * 0.2));

    let posts = 0;
    if (rand() < Math.min(0.97, perDay)) posts = 1;
    if (perDay > 1 && rand() < perDay - 1) posts += 1;

    const watchTime = p.watch ? Math.round(views * p.avgViewMin * (0.85 + rand() * 0.3)) : null;

    daily.push({ date, posts, views, reach, watchTime });
  }

  return {
    platform,
    handle,
    source: 'demo',
    hasWatchTime: !!p.watch,
    asOf: new Date(asOf).toISOString().slice(0, 10),
    daily
  };
}

module.exports = { generate };
