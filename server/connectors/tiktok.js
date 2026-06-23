'use strict';

const demo = require('./demoData');
const { emptyDaily, addDay } = require('../lib/series');

const PLATFORM = 'tiktok';

function isLive(account) {
  return (
    process.env.USE_DEMO_DATA !== 'true' &&
    !!process.env.TIKTOK_ACCESS_TOKEN &&
    !!(account && account.id)
  );
}

async function fetchMetrics({ clientId, account, days = 400, now }) {
  if (!isLive(account)) {
    return demo.generate({ platform: PLATFORM, clientId, handle: account.handle, days, now });
  }

  // ===========================================================================
  // LIVE TIKTOK (Display / Business API) — daily posts / views / reach
  // Docs: https://developers.tiktok.com/doc/display-api-overview
  // Each video is bucketed by its create_time: posts +1, views += view_count.
  // TikTok's basic tier has no separate "reach", so we approximate it from
  // views (refine with the Business API).
  // ===========================================================================
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  const asOf = now || Date.now();

  const fields = 'id,create_time,view_count';
  const res = await postJson(`https://open.tiktokapis.com/v2/video/list/?fields=${fields}`, token, { max_count: 50 });
  const videos = res.data?.videos || [];

  const series = emptyDaily(asOf, days);
  videos.forEach((v) => {
    const date = v.create_time ? new Date(v.create_time * 1000).toISOString().slice(0, 10) : '';
    const views = Number(v.view_count || 0);
    addDay(series, date, { posts: 1, views, reach: Math.round(views * 0.85) });
  });

  return { platform: PLATFORM, handle: account.handle, source: 'live', hasWatchTime: false, asOf: new Date(asOf).toISOString().slice(0, 10), daily: series.arr };
}

async function postJson(url, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!res.ok || (json.error && json.error.code && json.error.code !== 'ok')) {
    throw new Error(`TikTok API error: ${json.error ? json.error.message : 'HTTP ' + res.status}`);
  }
  return json;
}

module.exports = { fetchMetrics, isLive };
