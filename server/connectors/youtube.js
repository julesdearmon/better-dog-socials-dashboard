'use strict';

const demo = require('./demoData');
const { emptyDaily, addDay, DAY } = require('../lib/series');

const PLATFORM = 'youtube';
const DATA_API = 'https://www.googleapis.com/youtube/v3';
const ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2/reports';

function isLive(account) {
  return (
    process.env.USE_DEMO_DATA !== 'true' &&
    !!process.env.YOUTUBE_API_KEY &&
    !!process.env.YOUTUBE_ACCESS_TOKEN &&
    !!(account && account.id)
  );
}

async function fetchMetrics({ clientId, account, days = 400, now }) {
  if (!isLive(account)) {
    return demo.generate({ platform: PLATFORM, clientId, handle: account.handle, days, now });
  }

  // ===========================================================================
  // LIVE YOUTUBE (Data API v3 + Analytics API) — daily posts / views / reach / watch time
  // Docs: https://developers.google.com/youtube/analytics/reference/reports/query
  // account.id = channel ID (UC...). YouTube has no "reach" metric, so we use
  // uniqueViewers (distinct people who watched) as the closest analog.
  // watch time = estimatedMinutesWatched.
  //
  // ⚠ NOTE: uniqueViewers is NON-ADDITIVE — summing daily uniqueViewers into a
  // week/month overstates true unique reach (someone who watched on 3 days is
  // counted 3×). For exact period reach, query uniqueViewers once per aggregated
  // period (week/month) instead of summing the daily series.
  // ===========================================================================
  const key = process.env.YOUTUBE_API_KEY;
  const token = process.env.YOUTUBE_ACCESS_TOKEN;
  const id = account.id;
  const asOf = now || Date.now();
  const startDate = new Date(asOf - days * DAY).toISOString().slice(0, 10);
  const endDate = new Date(asOf - DAY).toISOString().slice(0, 10);

  const analytics = await getJson(
    `${ANALYTICS_API}?ids=channel==${id}&startDate=${startDate}&endDate=${endDate}` +
    `&metrics=views,estimatedMinutesWatched,uniqueViewers&dimensions=day&sort=day`,
    token
  );

  let uploads = [];
  const ch = await getJson(`${DATA_API}/channels?part=contentDetails&id=${id}&key=${key}`);
  const playlist = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (playlist) {
    const pl = await getJson(`${DATA_API}/playlistItems?part=contentDetails&playlistId=${playlist}&maxResults=50&key=${key}`);
    uploads = (pl.items || []).map((i) => i.contentDetails.videoPublishedAt || i.contentDetails.publishedAt);
  }

  const series = emptyDaily(asOf, days);
  // columnHeaders: day, views, estimatedMinutesWatched, uniqueViewers
  (analytics.rows || []).forEach((row) => {
    addDay(series, row[0], {
      views: Number(row[1] || 0),
      watchTime: Number(row[2] || 0),
      reach: Number(row[3] || 0) // uniqueViewers — see non-additive note above
    });
  });
  uploads.forEach((ts) => addDay(series, (ts || '').slice(0, 10), { posts: 1 }));

  return { platform: PLATFORM, handle: account.handle, source: 'live', hasWatchTime: true, asOf: new Date(asOf).toISOString().slice(0, 10), daily: series.arr };
}

async function getJson(url, token) {
  const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`YouTube API error: ${body.error ? (body.error.message || JSON.stringify(body.error)) : 'HTTP ' + res.status}`);
  return body;
}

module.exports = { fetchMetrics, isLive };
