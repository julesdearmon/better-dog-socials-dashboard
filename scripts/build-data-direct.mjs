#!/usr/bin/env node
/**
 * Direct API data builder for the Better Dog social dashboard.
 *
 * This is the fast internal version: tokens live in GitHub Actions secrets,
 * the workflow runs this script daily, and the script writes the same
 * public/data.json + public/realdata.js shape the dashboard already uses.
 *
 * Missing platforms are carried forward from the previous committed data file
 * so we can migrate one direct API at a time without blanking the dashboard.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '..', 'public');
const DATA_PATH = resolve(PUBLIC_DIR, 'data.json');

const DISPLAY_TZ = process.env.DISPLAY_TZ || 'America/New_York';
const WINDOW_DAYS = Number(process.env.WINDOW_DAYS || 300);
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const FETCH_TIMEOUT_MS = 15000;
const BUILD_DIAGNOSTICS = {};

const ACCT = {
  instagram: {
    id: process.env.META_IG_ACCOUNT_ID || '17841475238822164',
    handle: process.env.INSTAGRAM_HANDLE || '@betterdogsupplements',
  },
  facebook: {
    id: process.env.META_PAGE_ID || '674626722402999',
    handle: process.env.FACEBOOK_HANDLE || 'Better Dog Supplements',
  },
  youtube: {
    id: process.env.YOUTUBE_CHANNEL_ID || 'UC9rUabwMqe2C98J2l1NDz2g',
    handle: process.env.YOUTUBE_HANDLE || 'Better Dog Supplements',
  },
  tiktok: {
    handle: process.env.TIKTOK_HANDLE || '@betterdogsupplements',
  },
};

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dateOnly = (s) => (s == null ? '' : String(s).slice(0, 10));
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const yesterday = new Date(today);
yesterday.setUTCDate(today.getUTCDate() - 1);
const start = new Date(today);
start.setUTCDate(today.getUTCDate() - WINDOW_DAYS);

const ASOF = ymd(today);
const START = ymd(start);
const END = ymd(yesterday);

function axisDates() {
  const out = [];
  const d = new Date(start);
  while (ymd(d) <= END) {
    out.push(ymd(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const AXIS = axisDates();
const inAxis = (date) => date >= START && date <= END;
const addDays = (dateIso, days) => {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
};
const minIso = (a, b) => (a <= b ? a : b);
const unixDay = (dateIso, endOfDay = false) => Math.floor(Date.parse(`${dateIso}T${endOfDay ? '23:59:59' : '00:00:00'}Z`) / 1000);
const metaInsightDay = (endTime) => {
  const d = new Date(endTime);
  if (Number.isNaN(d.getTime())) return dateOnly(endTime);
  d.setUTCDate(d.getUTCDate() - 1);
  return ymd(d);
};

function friendlyStamp() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TZ,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(now);
}

function caption(text) {
  if (!text) return '';
  const s = String(text).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const m = s.match(/^[\s\S]*?[.!?\u2026]["'")\]]?(?=\s|$)/);
  let out = m ? m[0].trim() : s;
  if (out.length > 180) {
    const cut = out.slice(0, 180);
    const sp = cut.lastIndexOf(' ');
    out = (sp > 80 ? cut.slice(0, sp) : cut).trim() + '...';
  }
  return out;
}

function emptyDaily() {
  const map = new Map();
  for (const d of AXIS) map.set(d, { date: d, posts: 0, views: 0, reach: 0, watchTime: 0 });
  return map;
}

const toArr = (map) => AXIS.map((d) => map.get(d));

function carryForwardDaily(metric) {
  const byDate = new Map((metric?.daily || []).map((row) => [row.date, row]));
  return AXIS.map((date) => {
    const row = byDate.get(date);
    return {
      date,
      posts: row?.posts || 0,
      views: row?.views || 0,
      reach: row?.reach || 0,
      watchTime: row?.watchTime ?? (metric?.hasWatchTime ? 0 : null),
    };
  });
}

function loadPreviousData() {
  try {
    return JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('access_token')) parsed.searchParams.set('access_token', '[redacted]');
    return parsed.toString();
  } catch {
    return String(url).replace(/access_token=[^&\s]+/g, 'access_token=[redacted]');
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Request timed out after ${FETCH_TIMEOUT_MS}ms for ${safeUrl(url)}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url, token) {
  const res = await fetchWithTimeout(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Non-JSON response from ${safeUrl(url)}: ${text.slice(0, 300)}`);
  }
  if (!res.ok || body.error) {
    const msg = body.error?.message || body.error_description || JSON.stringify(body.error || body);
    throw new Error(`${res.status} ${msg}`);
  }
  return body;
}

async function postForm(url, body) {
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 300)}`);
  }
  if (!res.ok || json.error) {
    throw new Error(`${res.status} ${json.error_description || json.error || JSON.stringify(json)}`);
  }
  return json;
}

async function postJson(url, token, body) {
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 300)}`);
  }
  if (!res.ok || (json.error && json.error.code && json.error.code !== 'ok')) {
    throw new Error(`${res.status} ${json.error?.message || json.error_description || JSON.stringify(json.error || json)}`);
  }
  return json;
}

function metaBaseToken() {
  return process.env.META_USER_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
}

let cachedPageToken = null;
async function metaPageToken() {
  if (process.env.META_PAGE_ACCESS_TOKEN) return process.env.META_PAGE_ACCESS_TOKEN;
  if (cachedPageToken) return cachedPageToken;
  const base = metaBaseToken();
  if (!base) throw new Error('META_USER_ACCESS_TOKEN, META_PAGE_ACCESS_TOKEN, or META_ACCESS_TOKEN is required');
  try {
    const page = await metaGet(`/${ACCT.facebook.id}`, { fields: 'access_token' }, base);
    if (page.access_token) {
      cachedPageToken = page.access_token;
      return cachedPageToken;
    }
  } catch (err) {
    console.warn(`Could not derive page access token, using base Meta token: ${err.message}`);
  }
  return base;
}

async function metaGet(path, params = {}, token = metaBaseToken()) {
  if (!token) throw new Error('META_USER_ACCESS_TOKEN, META_PAGE_ACCESS_TOKEN, or META_ACCESS_TOKEN is required');
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${path.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(key, value);
  }
  url.searchParams.set('access_token', token);
  return getJson(url.toString());
}

async function logMetaPermissionDiagnostics() {
  const token = metaBaseToken();
  if (!token) return;
  try {
    const permissions = await metaGet('/me/permissions', {}, token);
    const granted = (permissions.data || []).filter((p) => p.status === 'granted').map((p) => p.permission).sort();
    const declined = (permissions.data || []).filter((p) => p.status !== 'granted').map((p) => `${p.permission}:${p.status}`).sort();
    console.log(`Meta token granted permissions: ${granted.join(', ') || 'none'}`);
    if (declined.length) console.warn(`Meta token non-granted permissions: ${declined.join(', ')}`);
  } catch (err) {
    console.warn(`Meta permission diagnostic unavailable: ${err.message}`);
  }
  try {
    const accounts = await metaGet('/me/accounts', { fields: 'id,name,tasks', limit: 100 }, token);
    const account = (accounts.data || []).find((item) => item.id === ACCT.facebook.id);
    if (account) {
      console.log(`Meta Page access found for configured Facebook Page: tasks=${(account.tasks || []).join(', ') || 'none'}`);
    } else {
      console.warn(`Meta Page access did not list the configured Facebook Page ID.`);
    }
  } catch (err) {
    console.warn(`Meta Page access diagnostic unavailable: ${err.message}`);
  }
}

async function metaPaged(path, params, stopWhen, token = metaBaseToken()) {
  const out = [];
  let next = null;
  do {
    const json = next ? await getJson(next) : await metaGet(path, params, token);
    for (const item of json.data || []) {
      if (stopWhen && stopWhen(item)) return out;
      out.push(item);
    }
    next = json.paging?.next || null;
  } while (next);
  return out;
}

function insightValue(json, names) {
  for (const name of names) {
    const item = (json.data || []).find((x) => x.name === name);
    const value = item?.values?.[0]?.value ?? item?.total_value?.value;
    if (value != null) return num(value);
  }
  return 0;
}

async function metaInsights(path, metricSets, token = metaBaseToken()) {
  let lastError = null;
  for (const metrics of metricSets) {
    try {
      return await metaGet(path, { metric: metrics.join(',') }, token);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error(`No insight metric set worked for ${path}`);
}

async function optionalMetaInsightValue(path, metricName, token = metaBaseToken()) {
  try {
    const insights = await metaGet(path, { metric: metricName }, token);
    return insightValue(insights, [metricName]);
  } catch (err) {
    console.warn(`  - skipping unavailable Meta insight metric ${metricName} for ${path}: ${err.message}`);
    return 0;
  }
}

async function metaDailyInsights(path, metricSets, token = metaBaseToken(), label = path) {
  let lastError = null;
  for (const metricSet of metricSets) {
    const metrics = Array.isArray(metricSet) ? metricSet : metricSet.metrics;
    const extraParams = Array.isArray(metricSet) ? {} : (metricSet.params || {});
    const byName = new Map();
    try {
      for (let chunkStart = START; chunkStart <= END; chunkStart = addDays(chunkStart, 30)) {
        const chunkEnd = minIso(addDays(chunkStart, 29), END);
        const json = await metaGet(path, {
          metric: metrics.join(','),
          period: 'day',
          since: chunkStart,
          until: addDays(chunkEnd, 1),
          ...extraParams,
        }, token);
        for (const item of json.data || []) {
          if (!byName.has(item.name)) byName.set(item.name, { ...item, values: [] });
          byName.get(item.name).values.push(...(item.values || []));
        }
      }
      const data = Array.from(byName.values());
      const hasDailyValues = data.some((item) => metrics.includes(item.name) && (item.values || []).length);
      if (!hasDailyValues) throw new Error(`No daily values returned for metrics [${metrics.join(', ')}]`);
      return { data };
    } catch (err) {
      lastError = err;
      console.warn(`  - ${label}: metrics [${metrics.join(', ')}] failed: ${err.message}`);
    }
  }
  throw lastError || new Error(`No Meta daily insight metric set worked for ${path}`);
}

function insightTotalValue(json, names) {
  for (const name of names) {
    const item = (json.data || []).find((x) => x.name === name);
    const value = item?.total_value?.value;
    if (value != null) return num(value);
    if ((item?.values || []).length) return (item.values || []).reduce((sum, row) => sum + num(row.value), 0);
  }
  return null;
}

async function metaRangeTotal(path, metricSets, startIso, endIso, token = metaBaseToken(), label = path) {
  let lastError = null;
  for (const metricSet of metricSets) {
    const metrics = Array.isArray(metricSet) ? metricSet : metricSet.metrics;
    const extraParams = Array.isArray(metricSet) ? {} : (metricSet.params || {});
    try {
      const json = await metaGet(path, {
        metric: metrics.join(','),
        period: 'day',
        since: startIso,
        until: addDays(endIso, 1),
        ...extraParams,
      }, token);
      const value = insightTotalValue(json, metrics);
      if (value == null) throw new Error(`No total value returned for metrics [${metrics.join(', ')}]`);
      return { metric: (json.data || []).find((item) => metrics.includes(item.name))?.name || metrics[0], value };
    } catch (err) {
      lastError = err;
      console.warn(`  - ${label}: range metrics [${metrics.join(', ')}] failed: ${err.message}`);
    }
  }
  throw lastError || new Error(`No Meta range insight metric set worked for ${path}`);
}

function applyFacebookPageInsights(daily, insights) {
  const byName = new Map((insights.data || []).map((item) => [item.name, item]));
  const views = byName.get('page_media_view') || byName.get('page_total_media_view') || byName.get('page_posts_impressions') || byName.get('page_impressions') || byName.get('page_views_total') || byName.get('page_video_views');
  const reach = byName.get('page_total_media_view_unique') || byName.get('page_posts_impressions_unique') || byName.get('page_impressions_unique');
  applyMetaDailyValues(daily, views, 'views');
  applyMetaDailyValues(daily, reach, 'reach');
  return {
    hasReach: Boolean(reach),
    viewsMetric: views?.name || '',
    reachMetric: reach?.name || '',
  };
}

function applyMetaDailyValues(daily, insight, field) {
  for (const value of insight?.values || []) {
    const date = metaInsightDay(value.end_time);
    if (!inAxis(date)) continue;
    const b = daily.get(date);
    if (b) b[field] += num(value.value);
  }
}

function applyInstagramAccountInsights(daily, insights) {
  const byName = new Map((insights.data || []).map((item) => [item.name, item]));
  const views = byName.get('content_views') || byName.get('views') || byName.get('impressions');
  const reach = byName.get('reach');
  for (const value of views?.values || []) {
    const date = metaInsightDay(value.end_time);
    if (!inAxis(date)) continue;
    const b = daily.get(date);
    if (b) b.views += num(value.value);
  }
  for (const value of reach?.values || []) {
    const date = metaInsightDay(value.end_time);
    if (!inAxis(date)) continue;
    const b = daily.get(date);
    if (b) b.reach += num(value.value);
  }
  return {
    hasReach: Boolean(reach),
    viewsMetric: views?.name || '',
    reachMetric: reach?.name || '',
  };
}

async function pullInstagram() {
  const token = metaBaseToken();
  if (!token) throw new Error('META_USER_ACCESS_TOKEN, META_PAGE_ACCESS_TOKEN, or META_ACCESS_TOKEN is required');
  const { id, handle } = ACCT.instagram;
  const daily = emptyDaily();
  const content = [];
  let accountInsightSummary = null;
  try {
    const accountInsights = await metaDailyInsights(`/${id}/insights`, [
      { metrics: ['content_views'], params: { metric_type: 'total_value' } },
      ['content_views', 'reach'],
      ['content_views'],
      { metrics: ['views'], params: { metric_type: 'total_value' } },
      ['views', 'reach'],
      ['views'],
      ['reach'],
      { metrics: ['impressions', 'reach'], params: { metric_type: 'total_value' } },
      ['impressions', 'reach'],
    ], token, 'Instagram account insights');
    accountInsightSummary = applyInstagramAccountInsights(daily, accountInsights);
    if (!accountInsightSummary.viewsMetric) {
      console.warn('  - Instagram account-level daily views metric unavailable, falling back to media-level totals');
      accountInsightSummary = null;
      for (const row of daily.values()) {
        row.views = 0;
        row.reach = 0;
      }
    }
  } catch (err) {
    console.warn(`  - Instagram account-level daily insights unavailable, falling back to media-level totals: ${err.message}`);
  }
  const fields = 'id,timestamp,permalink,media_type,caption,like_count,comments_count';
  const media = await metaPaged(
    `/${id}/media`,
    { fields, limit: 100 },
    (item) => dateOnly(item.timestamp) < START
  );

  const typeOf = (t) => (t === 'VIDEO' || t === 'REELS' ? 'Short Form Clip' : t === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Single Image');
  for (const item of media) {
    const date = dateOnly(item.timestamp);
    if (!inAxis(date)) continue;
    const insights = await metaInsights(`/${item.id}/insights`, [
      ['reach', 'views', 'total_interactions'],
      ['reach', 'plays', 'total_interactions'],
      ['reach', 'impressions', 'total_interactions'],
    ], token);
    const views = insightValue(insights, ['views', 'plays', 'impressions']);
    const reach = insightValue(insights, ['reach']);
    const engagement = num(item.like_count) + num(item.comments_count) || insightValue(insights, ['total_interactions']);
    const b = daily.get(date);
    b.posts += 1;
    if (!accountInsightSummary) {
      b.views += views;
      b.reach += reach;
    }
    content.push({
      platform: 'instagram',
      date,
      url: item.permalink || '',
      title: caption(item.caption),
      type: typeOf(item.media_type),
      views,
      reach,
      eng: engagement,
    });
  }

  return {
    metric: {
      platform: 'instagram',
      handle,
      source: 'live',
      provider: accountInsightSummary?.viewsMetric ? `meta-ig-user-insights-api:${accountInsightSummary.viewsMetric}` : 'meta-media-insights-api',
      hasWatchTime: false,
      hasReach: accountInsightSummary ? accountInsightSummary.hasReach : true,
      reachUnavailableReason: accountInsightSummary && !accountInsightSummary.hasReach ? 'Current Instagram account insight fallback did not provide reach.' : '',
      asOf: ASOF,
      daily: toArr(daily),
    },
    content,
  };
}

async function pullFacebook() {
  const token = await metaPageToken();
  const { id, handle } = ACCT.facebook;
  const daily = emptyDaily();
  const content = [];
  const pageInsights = await metaDailyInsights(`/${id}/insights`, [
    { metrics: ['page_media_view', 'page_total_media_view_unique'], params: { metric_type: 'total_value' } },
    { metrics: ['page_media_view'], params: { metric_type: 'total_value' } },
    { metrics: ['page_total_media_view', 'page_total_media_view_unique'], params: { metric_type: 'total_value' } },
    { metrics: ['page_total_media_view'], params: { metric_type: 'total_value' } },
    ['page_media_view', 'page_total_media_view_unique'],
    ['page_media_view'],
    ['page_total_media_view', 'page_total_media_view_unique'],
    ['page_total_media_view'],
    ['page_total_media_view_unique'],
    ['page_posts_impressions', 'page_posts_impressions_unique'],
    ['page_impressions', 'page_impressions_unique'],
    ['page_views_total'],
    ['page_video_views'],
  ], token, 'Facebook page insights');
  const pageInsightSummary = applyFacebookPageInsights(daily, pageInsights);
  const pageViewsOnly = pageInsightSummary.viewsMetric === 'page_views_total';
  const hasFacebookContentViews = ['page_media_view', 'page_total_media_view'].includes(pageInsightSummary.viewsMetric);

  if (!hasFacebookContentViews) {
    console.warn('  - Facebook Business Suite content views unavailable; skipping post-detail probes that do not match Content Overview totals.');
    return {
      metric: {
        platform: 'facebook',
        handle,
        source: 'live',
        provider: pageInsightSummary.viewsMetric ? `meta-page-insights-api:${pageInsightSummary.viewsMetric}` : 'meta-page-insights-api',
        hasViews: false,
        viewsUnavailableReason: pageViewsOnly
          ? 'Meta only exposed Page/profile views for Facebook, not content views for the selected date range. Page views are excluded from the main content-view totals.'
          : 'Meta did not expose Facebook Business Suite content views for the selected date range.',
        hasWatchTime: false,
        hasReach: pageInsightSummary.hasReach,
        reachLabel: pageInsightSummary.reachMetric === 'page_total_media_view_unique' ? 'Viewers' : 'Reach',
        reachNote: pageInsightSummary.reachMetric === 'page_total_media_view_unique' ? 'Facebook uses Business Suite Viewers as its reach metric.' : '',
        reachUnavailableReason: pageInsightSummary.hasReach ? '' : 'Current Meta Page Insights fallback did not provide a matching reach metric.',
        asOf: ASOF,
        daily: toArr(daily),
      },
      content,
    };
  }

  console.warn('  - Facebook top-line totals are coming from Page Insights; skipping slow post-detail probes until matching post-level metrics are confirmed.');
  return {
    metric: {
      platform: 'facebook',
      handle,
      source: 'live',
      provider: pageInsightSummary.viewsMetric ? `meta-page-insights-api:${pageInsightSummary.viewsMetric}` : 'meta-page-insights-api',
      hasViews: !pageViewsOnly,
      viewsUnavailableReason: pageViewsOnly ? 'Meta only exposed Page/profile views for Facebook, not content views for the selected date range. Page views are excluded from the main content-view totals.' : '',
      hasWatchTime: false,
      hasReach: pageInsightSummary.hasReach,
      reachLabel: pageInsightSummary.reachMetric === 'page_total_media_view_unique' ? 'Viewers' : 'Reach',
      reachNote: pageInsightSummary.reachMetric === 'page_total_media_view_unique' ? 'Facebook uses Business Suite Viewers as its reach metric.' : '',
      reachUnavailableReason: pageInsightSummary.hasReach ? '' : 'Current Meta Page Insights fallback did not provide a matching reach metric.',
      asOf: ASOF,
      daily: toArr(daily),
    },
    content,
  };

  const fields = [
    'id',
    'created_time',
    'permalink_url',
    'message',
    'status_type',
    'attachments{media_type,type}',
    'shares',
  ].join(',');
  const posts = [];
  try {
    for (let chunkStart = START; chunkStart <= END; chunkStart = addDays(chunkStart, 30)) {
      const chunkEnd = minIso(addDays(chunkStart, 29), END);
      const chunk = await metaPaged(
        `/${id}/posts`,
        { fields, limit: 25, since: unixDay(chunkStart), until: unixDay(chunkEnd, true) },
        null,
        token
      );
      posts.push(...chunk);
    }
  } catch (err) {
    console.warn(`  - Facebook post list unavailable, using page-level daily insights only: ${err.message}`);
  }

  const typeOf = (post) => {
    const s = `${post.status_type || ''} ${post.attachments?.data?.[0]?.media_type || ''} ${post.attachments?.data?.[0]?.type || ''}`.toLowerCase();
    if (s.includes('video')) return 'Short Form Clip';
    if (s.includes('album') || s.includes('carousel')) return 'Carousel';
    if (s.includes('photo') || s.includes('image')) return 'Single Image';
    return 'Text Post';
  };

  for (const post of posts) {
    const date = dateOnly(post.created_time);
    if (!inAxis(date)) continue;
    const insightsPath = `/${post.id}/insights`;
    const impressions = await optionalMetaInsightValue(insightsPath, 'post_impressions', token);
    const videoViews = await optionalMetaInsightValue(insightsPath, 'post_video_views', token);
    const views = videoViews || impressions;
    const reach = await optionalMetaInsightValue(insightsPath, 'post_impressions_unique', token);
    let reactions = 0;
    let comments = 0;
    try {
      const engagement = await metaGet(`/${post.id}`, { fields: 'reactions.summary(true),comments.summary(true)' }, token);
      reactions = num(engagement.reactions?.summary?.total_count);
      comments = num(engagement.comments?.summary?.total_count);
    } catch (err) {
      console.warn(`  - skipping Facebook engagement summary for ${post.id}: ${err.message}`);
    }
    const eng = reactions + comments + num(post.shares?.count);
    const b = daily.get(date);
    b.posts += 1;
    content.push({
      platform: 'facebook',
      date,
      url: post.permalink_url || '',
      title: caption(post.message),
      type: typeOf(post),
      views,
      reach,
      eng,
    });
  }

  return {
    metric: {
      platform: 'facebook',
      handle,
      source: 'live',
      provider: pageInsightSummary.viewsMetric ? `meta-page-insights-api:${pageInsightSummary.viewsMetric}` : 'meta-page-insights-api',
      hasViews: !pageViewsOnly,
      viewsUnavailableReason: pageViewsOnly ? 'Meta only exposed Page/profile views for Facebook, not content views for the selected date range. Page views are excluded from the main content-view totals.' : '',
      hasWatchTime: false,
      hasReach: pageInsightSummary.hasReach,
      reachLabel: pageInsightSummary.reachMetric === 'page_total_media_view_unique' ? 'Viewers' : 'Reach',
      reachNote: pageInsightSummary.reachMetric === 'page_total_media_view_unique' ? 'Facebook uses Business Suite Viewers as its reach metric.' : '',
      reachUnavailableReason: pageInsightSummary.hasReach ? '' : 'Current Meta Page Insights fallback did not provide a matching reach metric.',
      asOf: ASOF,
      daily: toArr(daily),
    },
    content,
  };
}

function completeFriThuWeeks(count = 12) {
  const end = new Date(`${END}T00:00:00Z`);
  const back = (end.getUTCDay() - 4 + 7) % 7;
  const thu = new Date(end);
  thu.setUTCDate(end.getUTCDate() - back);
  const weeks = [];
  for (let i = 0; i < count; i++) {
    const hi = new Date(thu);
    hi.setUTCDate(thu.getUTCDate() - i * 7);
    const lo = new Date(hi);
    lo.setUTCDate(hi.getUTCDate() - 6);
    weeks.push({ start: ymd(lo), end: ymd(hi) });
  }
  return weeks;
}

async function optionalMetaRangeTotal(path, metricSets, startIso, endIso, token, label) {
  try {
    return await metaRangeTotal(path, metricSets, startIso, endIso, token, label);
  } catch (err) {
    console.warn(`  - ${label}: unavailable for ${startIso} to ${endIso}: ${err.message}`);
    return null;
  }
}

async function buildMetaRangeOverrides() {
  const token = metaBaseToken();
  if (!token) return [];
  const pageToken = await metaPageToken();
  BUILD_DIAGNOSTICS.facebookViewerMetrics = await logFacebookViewerDiagnostics(pageToken);
  const overrides = [];
  for (const range of completeFriThuWeeks(4)) {
    const igViews = await optionalMetaRangeTotal(`/${ACCT.instagram.id}/insights`, [
      { metrics: ['content_views'], params: { metric_type: 'total_value' } },
      { metrics: ['views'], params: { metric_type: 'total_value' } },
    ], range.start, range.end, token, 'Instagram Business Suite views');
    const igReach = await optionalMetaRangeTotal(`/${ACCT.instagram.id}/insights`, [
      { metrics: ['reach'], params: { metric_type: 'total_value' } },
    ], range.start, range.end, token, 'Instagram Business Suite reach');
    if (igViews?.value != null || igReach?.value != null) {
      overrides.push({
        platform: 'instagram',
        ...range,
        source: `Meta API range totals (${[igViews?.metric, igReach?.metric].filter(Boolean).join(', ')})`,
        values: {
          ...(igViews?.value != null ? { views: igViews.value } : {}),
          ...(igReach?.value != null ? { reach: igReach.value } : {}),
        },
      });
    }

    const fbViews = await optionalMetaRangeTotal(`/${ACCT.facebook.id}/insights`, [
      { metrics: ['page_media_view'], params: { metric_type: 'total_value' } },
      { metrics: ['page_total_media_view'], params: { metric_type: 'total_value' } },
    ], range.start, range.end, pageToken, 'Facebook Business Suite views');
    const fbReach = await optionalMetaRangeTotal(`/${ACCT.facebook.id}/insights`, [
      { metrics: ['page_total_media_view_unique'], params: { metric_type: 'total_value' } },
    ], range.start, range.end, pageToken, 'Facebook Business Suite viewers');
    if (fbViews?.value != null) {
      overrides.push({
        platform: 'facebook',
        ...range,
        source: `Meta API range totals (${[fbViews?.metric, fbReach?.metric].filter(Boolean).join(', ')})`,
        labels: { reach: 'Viewers' },
        values: {
          ...(fbViews?.value != null ? { views: fbViews.value } : {}),
          ...(fbReach?.value != null ? { reach: fbReach.value } : {}),
        },
      });
    }
  }
  return overrides;
}

async function logFacebookViewerDiagnostics(pageToken) {
  const startIso = '2026-06-19';
  const endIso = '2026-06-25';
  const diagnostics = { range: { start: startIso, end: endIso }, candidates: [] };
  const candidates = [
    { label: 'page media views', path: `/${ACCT.facebook.id}/insights`, metric: 'page_media_view', params: { metric_type: 'total_value' } },
    { label: 'page media views by organic ads', path: `/${ACCT.facebook.id}/insights`, metric: 'page_media_view', params: { metric_type: 'total_value', breakdown: 'is_from_ads' } },
    { label: 'page media viewers', path: `/${ACCT.facebook.id}/insights`, metric: 'page_total_media_view_unique', params: { metric_type: 'total_value' } },
    { label: 'page media viewers by organic ads', path: `/${ACCT.facebook.id}/insights`, metric: 'page_total_media_view_unique', params: { metric_type: 'total_value', breakdown: 'is_from_ads' } },
    { label: 'page media viewers week', path: `/${ACCT.facebook.id}/insights`, metric: 'page_total_media_view_unique', params: { period: 'week' } },
    { label: 'page media view unique singular', path: `/${ACCT.facebook.id}/insights`, metric: 'page_media_view_unique', params: { metric_type: 'total_value' } },
    { label: 'page media views plural', path: `/${ACCT.facebook.id}/insights`, metric: 'page_media_views', params: { metric_type: 'total_value' } },
    { label: 'page media viewers plural', path: `/${ACCT.facebook.id}/insights`, metric: 'page_media_views_unique', params: { metric_type: 'total_value' } },
    { label: 'page total media views plural', path: `/${ACCT.facebook.id}/insights`, metric: 'page_total_media_views', params: { metric_type: 'total_value' } },
    { label: 'page total media viewers plural', path: `/${ACCT.facebook.id}/insights`, metric: 'page_total_media_views_unique', params: { metric_type: 'total_value' } },
    { label: 'page content views', path: `/${ACCT.facebook.id}/insights`, metric: 'page_content_views', params: { metric_type: 'total_value' } },
    { label: 'page content viewers', path: `/${ACCT.facebook.id}/insights`, metric: 'page_content_views_unique', params: { metric_type: 'total_value' } },
    { label: 'page total content views', path: `/${ACCT.facebook.id}/insights`, metric: 'page_total_content_views', params: { metric_type: 'total_value' } },
    { label: 'page total content viewers', path: `/${ACCT.facebook.id}/insights`, metric: 'page_total_content_views_unique', params: { metric_type: 'total_value' } },
    { label: 'page content view singular', path: `/${ACCT.facebook.id}/insights`, metric: 'page_content_view', params: { metric_type: 'total_value' } },
    { label: 'page content viewer singular', path: `/${ACCT.facebook.id}/insights`, metric: 'page_content_view_unique', params: { metric_type: 'total_value' } },
    { label: 'content views generic', path: `/${ACCT.facebook.id}/insights`, metric: 'content_views', params: { metric_type: 'total_value' } },
    { label: 'content viewers generic', path: `/${ACCT.facebook.id}/insights`, metric: 'content_views_unique', params: { metric_type: 'total_value' } },
    { label: 'views generic', path: `/${ACCT.facebook.id}/insights`, metric: 'views', params: { metric_type: 'total_value' } },
    { label: 'reach generic', path: `/${ACCT.facebook.id}/insights`, metric: 'reach', params: { metric_type: 'total_value' } },
    { label: 'page total reach legacy', path: `/${ACCT.facebook.id}/insights`, metric: 'page_impressions_unique', params: {} },
    { label: 'page post reach legacy', path: `/${ACCT.facebook.id}/insights`, metric: 'page_posts_impressions_unique', params: {} },
    { label: 'page video viewers legacy', path: `/${ACCT.facebook.id}/insights`, metric: 'page_video_views_unique', params: {} },
  ];
  console.log(`Facebook viewer diagnostic for ${startIso} to ${endIso}:`);
  for (const candidate of candidates) {
    try {
      const period = candidate.params.period || 'day';
      const json = await metaGet(candidate.path, {
        metric: candidate.metric,
        period,
        since: startIso,
        until: addDays(endIso, 1),
        ...candidate.params,
      }, pageToken);
      const value = insightTotalValue(json, [candidate.metric]);
      const item = (json.data || []).find((x) => x.name === candidate.metric);
      const rawValue = item?.total_value?.value;
      const breakdowns = item?.total_value?.breakdowns || item?.values?.[0]?.value || null;
      diagnostics.candidates.push({ label: candidate.label, metric: candidate.metric, period, value, rawValue, breakdowns });
      console.log(`  - ${candidate.label} (${candidate.metric}): ${value}`);
    } catch (err) {
      diagnostics.candidates.push({ label: candidate.label, metric: candidate.metric, error: err.message });
      console.warn(`  - ${candidate.label} (${candidate.metric}) failed: ${err.message}`);
    }
  }
  try {
    const posts = await metaPaged(
      `/${ACCT.facebook.id}/posts`,
      { fields: 'id,created_time', limit: 25, since: unixDay(startIso), until: unixDay(endIso, true) },
      null,
      pageToken
    );
    let postViews = 0;
    let postViewers = 0;
    let postViewsDated = 0;
    let postViewersDated = 0;
    for (const post of posts) {
      postViews += await optionalMetaInsightValue(`/${post.id}/insights`, 'post_media_view', pageToken);
      postViewers += await optionalMetaInsightValue(`/${post.id}/insights`, 'post_total_media_view_unique', pageToken);
      postViewsDated += await optionalMetaDatedInsightTotal(`/${post.id}/insights`, 'post_media_view', startIso, endIso, pageToken);
      postViewersDated += await optionalMetaDatedInsightTotal(`/${post.id}/insights`, 'post_total_media_view_unique', startIso, endIso, pageToken);
    }
    diagnostics.candidates.push({ label: 'sum post media views', metric: 'post_media_view', postCount: posts.length, value: postViews });
    diagnostics.candidates.push({ label: 'sum post media viewers', metric: 'post_total_media_view_unique', postCount: posts.length, value: postViewers });
    diagnostics.candidates.push({ label: 'sum dated post media views', metric: 'post_media_view', postCount: posts.length, period: 'day', value: postViewsDated });
    diagnostics.candidates.push({ label: 'sum dated post media viewers', metric: 'post_total_media_view_unique', postCount: posts.length, period: 'day', value: postViewersDated });
  } catch (err) {
    diagnostics.candidates.push({ label: 'post media sums', error: err.message });
  }
  return diagnostics;
}

async function optionalMetaDatedInsightTotal(path, metric, startIso, endIso, token) {
  try {
    const json = await metaGet(path, {
      metric,
      period: 'day',
      since: startIso,
      until: addDays(endIso, 1),
    }, token);
    return insightTotalValue(json, [metric]) || 0;
  } catch (err) {
    return 0;
  }
}

async function googleAccessToken() {
  const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN } = process.env;
  if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REFRESH_TOKEN) {
    throw new Error('YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REFRESH_TOKEN are required');
  }
  const json = await postForm('https://oauth2.googleapis.com/token', {
    client_id: YOUTUBE_CLIENT_ID,
    client_secret: YOUTUBE_CLIENT_SECRET,
    refresh_token: YOUTUBE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  return json.access_token;
}

async function youtubeAnalytics(token, params) {
  const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return getJson(url.toString(), token);
}

function isoDurationSeconds(duration) {
  const m = String(duration || '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  return num(m[1]) * 3600 + num(m[2]) * 60 + num(m[3]);
}

async function youtubeData(token, path, params = {}) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return getJson(url.toString(), token);
}

async function pullYouTube() {
  const token = await googleAccessToken();
  const { id, handle } = ACCT.youtube;
  const daily = emptyDaily();

  const traffic = await youtubeAnalytics(token, {
    ids: 'channel==MINE',
    startDate: START,
    endDate: END,
    metrics: 'views,estimatedMinutesWatched',
    dimensions: 'day,insightTrafficSourceType',
    sort: 'day',
    maxResults: '10000',
  });
  for (const row of traffic.rows || []) {
    const [date, source, views, watchTime] = row;
    if (!inAxis(date) || String(source).toUpperCase() === 'ADVERTISING') continue;
    const b = daily.get(date);
    b.views += num(views);
    b.watchTime += num(watchTime);
  }

  const channel = await youtubeData(token, 'channels', { part: 'id,contentDetails', mine: 'true' });
  const uploads = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error('No uploads playlist found for the authorized YouTube channel');

  const videos = [];
  let pageToken = '';
  do {
    const page = await youtubeData(token, 'playlistItems', {
      part: 'snippet,contentDetails',
      playlistId: uploads,
      maxResults: '50',
      pageToken,
    });
    for (const item of page.items || []) {
      const published = dateOnly(item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt);
      if (published < START) {
        pageToken = '';
        break;
      }
      if (inAxis(published)) videos.push({ id: item.contentDetails.videoId, date: published });
    }
    pageToken = pageToken === '' ? '' : page.nextPageToken || '';
  } while (pageToken);

  const content = [];
  for (let i = 0; i < videos.length; i += 50) {
    const batch = videos.slice(i, i + 50);
    const details = await youtubeData(token, 'videos', {
      part: 'snippet,statistics,contentDetails',
      id: batch.map((v) => v.id).join(','),
      maxResults: '50',
    });
    for (const item of details.items || []) {
      const date = dateOnly(item.snippet?.publishedAt);
      if (!inAxis(date)) continue;
      daily.get(date).posts += 1;
      const views = num(item.statistics?.viewCount);
      content.push({
        platform: 'youtube',
        date,
        url: `https://www.youtube.com/watch?v=${item.id}`,
        title: item.snippet?.title || '',
        type: isoDurationSeconds(item.contentDetails?.duration) <= 180 ? 'Short Form Clip' : 'Video',
        views,
        reach: null,
        eng: num(item.statistics?.likeCount) + num(item.statistics?.commentCount),
      });
    }
  }

  return {
    metric: { platform: 'youtube', handle, source: 'live', provider: 'youtube-apis', hasWatchTime: true, hasReach: false, organicOnly: true, asOf: ASOF, daily: toArr(daily) },
    content,
  };
}

async function tiktokAccessToken() {
  const { TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REFRESH_TOKEN } = process.env;
  if (!TIKTOK_CLIENT_KEY || !TIKTOK_CLIENT_SECRET || !TIKTOK_REFRESH_TOKEN) {
    throw new Error('TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, and TIKTOK_REFRESH_TOKEN are required');
  }
  const json = await postForm('https://open.tiktokapis.com/v2/oauth/token/', {
    client_key: TIKTOK_CLIENT_KEY,
    client_secret: TIKTOK_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: TIKTOK_REFRESH_TOKEN,
  });
  if (json.refresh_token && json.refresh_token !== TIKTOK_REFRESH_TOKEN) {
    console.warn('TikTok returned a rotated refresh token. Update the TIKTOK_REFRESH_TOKEN GitHub secret soon.');
  }
  return json.access_token;
}

async function pullTikTok() {
  const token = await tiktokAccessToken();
  const { handle } = ACCT.tiktok;
  const daily = emptyDaily();
  const content = [];
  const fields = 'id,create_time,share_url,title,view_count,like_count,comment_count,share_count,duration';
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    const body = { max_count: 20 };
    if (cursor != null) body.cursor = cursor;
    const page = await postJson(`https://open.tiktokapis.com/v2/video/list/?fields=${encodeURIComponent(fields)}`, token, body);
    const data = page.data || {};
    for (const item of data.videos || []) {
      const date = item.create_time ? ymd(new Date(num(item.create_time) * 1000)) : '';
      if (date < START) {
        hasMore = false;
        break;
      }
      if (!inAxis(date)) continue;
      const views = num(item.view_count);
      const b = daily.get(date);
      b.posts += 1;
      b.views += views;
      content.push({
        platform: 'tiktok',
        date,
        url: item.share_url || '',
        title: caption(item.title),
        type: 'Short Form Clip',
        views,
        reach: null,
        eng: num(item.like_count) + num(item.comment_count) + num(item.share_count),
      });
    }
    cursor = data.cursor;
    hasMore = !!data.has_more && hasMore;
  }

  return {
    metric: { platform: 'tiktok', handle, source: 'live', provider: 'tiktok-display-api', hasWatchTime: false, hasReach: false, reachUnavailableReason: 'TikTok Display API does not expose organic reach.', asOf: ASOF, daily: toArr(daily) },
    content,
  };
}

function weekSummary(metrics) {
  const end = new Date(`${END}T00:00:00Z`);
  const back = (end.getUTCDay() - 4 + 7) % 7;
  const thu = new Date(end);
  thu.setUTCDate(end.getUTCDate() - back);
  const fri = new Date(thu);
  fri.setUTCDate(thu.getUTCDate() - 6);
  const lo = ymd(fri);
  const hi = ymd(thu);
  const sum = { posts: 0, views: 0, reach: 0, watch: 0 };
  for (const p of Object.values(metrics)) {
    for (const d of p.daily || []) {
      if (d.date >= lo && d.date <= hi) {
        sum.posts += d.posts || 0;
        sum.views += d.views || 0;
        if (p.hasReach !== false) sum.reach += d.reach || 0;
        sum.watch += d.watchTime || 0;
      }
    }
  }
  return { lo, hi, sum };
}

function mergeWithPrevious(results, previous) {
  const metrics = {};
  let content = [];
  const carried = [];
  for (const platform of ['instagram', 'facebook', 'youtube', 'tiktok']) {
    if (results[platform]) {
      metrics[platform] = results[platform].metric;
      content = content.concat(results[platform].content);
      continue;
    }
    const priorMetric = previous?.metrics?.[platform];
    if (priorMetric) {
      metrics[platform] = {
        ...priorMetric,
        carriedForward: true,
        daily: carryForwardDaily(priorMetric),
      };
      content = content.concat((previous.content || []).filter((item) => item.platform === platform && inAxis(item.date)));
      carried.push(platform);
    }
  }
  return { metrics, content, carried };
}

async function main() {
  console.log(`Pulling direct APIs ${START} to ${END} (asOf ${ASOF})`);
  await logMetaPermissionDiagnostics();
  const previous = loadPreviousData();
  const results = {};
  const errors = [];
  for (const [name, fn, configured] of [
    ['instagram', pullInstagram, !!metaBaseToken()],
    ['facebook', pullFacebook, !!metaBaseToken()],
    ['youtube', pullYouTube, !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN)],
    ['tiktok', pullTikTok, !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET && process.env.TIKTOK_REFRESH_TOKEN)],
  ]) {
    if (!configured) {
      errors.push(`${name}: credentials not configured`);
      console.warn(`  - ${name}: credentials not configured, carrying forward previous data if available`);
      continue;
    }
    try {
      results[name] = await fn();
      console.log(`  OK ${name}: ${results[name].content.length} posts`);
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
      console.error(`  FAIL ${name}: ${err.message}`);
    }
  }

  if (!Object.keys(results).length) {
    console.error('FATAL: no direct API source succeeded. Not writing files.');
    console.error(errors.join('\n'));
    process.exit(1);
  }

  const { metrics, content, carried } = mergeWithPrevious(results, previous);
  const rangeOverrides = await buildMetaRangeOverrides();
  const data = {
    client: previous?.client || { id: 'better-dog-supplements', name: 'Better Dog Supplements', color: '#88cc33' },
    asOf: ASOF,
    updatedAt: friendlyStamp(),
    source: 'live',
    generatedFrom: `Direct APIs (${Object.keys(results).join(', ')})${carried.length ? `; carried forward: ${carried.join(', ')}` : ''}`,
    directApiErrors: errors,
    rangeOverrides,
    diagnostics: BUILD_DIAGNOSTICS,
    metrics,
    content,
  };

  mkdirSync(PUBLIC_DIR, { recursive: true });
  const json = JSON.stringify(data, null, 2);
  writeFileSync(DATA_PATH, json + '\n');
  writeFileSync(resolve(PUBLIC_DIR, 'realdata.js'), `// Real data embedded for file:// usage; loaded by app.js as window.REAL_DATA.\nwindow.REAL_DATA = ${json};\n`);

  const { lo, hi, sum } = weekSummary(metrics);
  console.log(`Wrote data.json + realdata.js. Latest Fri-Thu week ${lo} to ${hi}: ` +
    `${sum.posts} posts / ${sum.views.toLocaleString()} views / ${sum.reach.toLocaleString()} reach / ` +
    `${Math.round(sum.watch / 60)} hrs YT watch. ${content.length} content records.`);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
