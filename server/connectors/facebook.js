'use strict';

const demo = require('./demoData');
const { emptyDaily, addDay, windowSeconds } = require('../lib/series');

const PLATFORM = 'facebook';
const GRAPH = 'https://graph.facebook.com/v19.0';

function isLive(account) {
  return (
    process.env.USE_DEMO_DATA !== 'true' &&
    !!process.env.META_ACCESS_TOKEN &&
    !!(account && account.id)
  );
}

async function fetchMetrics({ clientId, account, days = 400, now }) {
  if (!isLive(account)) {
    return demo.generate({ platform: PLATFORM, clientId, handle: account.handle, days, now });
  }

  // ===========================================================================
  // LIVE FACEBOOK PAGE (Meta Graph API) — daily posts / views / reach
  // Docs: https://developers.facebook.com/docs/graph-api/reference/page/insights
  // account.id = Page ID; token needs read_insights + pages_read_engagement.
  // ===========================================================================
  const token = process.env.META_ACCESS_TOKEN;
  const id = account.id;
  const asOf = now || Date.now();
  const { since, until } = windowSeconds(asOf, days);

  const insightsUrl =
    `${GRAPH}/${id}/insights?metric=page_impressions_unique,page_impressions&period=day` +
    `&since=${since}&until=${until}&access_token=${token}`;
  const postsUrl =
    `${GRAPH}/${id}/posts?fields=id,created_time&limit=200&since=${since}&access_token=${token}`;

  const [insights, posts] = await Promise.all([getJson(insightsUrl), getJson(postsUrl)]);

  const series = emptyDaily(asOf, days);
  seriesFor(insights, 'page_impressions_unique').forEach((v) => addDay(series, (v.end_time || '').slice(0, 10), { reach: Number(v.value || 0) }));
  seriesFor(insights, 'page_impressions').forEach((v) => addDay(series, (v.end_time || '').slice(0, 10), { views: Number(v.value || 0) }));
  (posts.data || []).forEach((p) => addDay(series, (p.created_time || '').slice(0, 10), { posts: 1 }));

  return result(account, asOf, series.arr);
}

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`Facebook API error: ${body.error ? body.error.message : 'HTTP ' + res.status}`);
  return body;
}
function seriesFor(insights, name) {
  const m = (insights.data || []).find((x) => x.name === name);
  return m ? m.values || [] : [];
}
function result(account, asOf, daily) {
  return { platform: PLATFORM, handle: account.handle, source: 'live', hasWatchTime: false, asOf: new Date(asOf).toISOString().slice(0, 10), daily };
}

module.exports = { fetchMetrics, isLive };
