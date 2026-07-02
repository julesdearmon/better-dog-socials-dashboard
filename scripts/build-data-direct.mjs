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
const API_RETRY_ATTEMPTS = Number(process.env.API_RETRY_ATTEMPTS || 3);
const API_RETRY_BASE_MS = Number(process.env.API_RETRY_BASE_MS || 1200);

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
const hasTikTokBusinessCreds = () => !!(process.env.TIKTOK_BUSINESS_ACCESS_TOKEN && process.env.TIKTOK_BUSINESS_ID);
const hasTikTokDisplayCreds = () => !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET && process.env.TIKTOK_REFRESH_TOKEN);

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetriableHttpStatus(status) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isRetriableError(err) {
  if (err?.retriable) return true;
  const msg = String(err?.message || err);
  return /timed out|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network/i.test(msg);
}

async function withRetry(label, fn) {
  let lastError = null;
  for (let attempt = 1; attempt <= API_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= API_RETRY_ATTEMPTS || !isRetriableError(err)) throw err;
      const delay = API_RETRY_BASE_MS * attempt;
      console.warn(`  - retrying ${label} after transient error (${attempt}/${API_RETRY_ATTEMPTS}): ${err.message}`);
      await sleep(delay);
    }
  }
  throw lastError;
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
  return withRetry(`GET ${safeUrl(url)}`, async () => {
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
      const err = new Error(`${res.status} ${msg}`);
      if (isRetriableHttpStatus(res.status)) err.retriable = true;
      throw err;
    }
    return body;
  });
}

async function postForm(url, body) {
  return withRetry(`POST ${url}`, async () => {
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
      const err = new Error(`${res.status} ${json.error_description || json.error || JSON.stringify(json)}`);
      if (isRetriableHttpStatus(res.status)) err.retriable = true;
      throw err;
    }
    return json;
  });
}

async function postJson(url, token, body) {
  return withRetry(`POST ${url}`, async () => {
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
      const err = new Error(`${res.status} ${json.error?.message || json.error_description || JSON.stringify(json.error || json)}`);
      if (isRetriableHttpStatus(res.status)) err.retriable = true;
      throw err;
    }
    return json;
  });
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

async function optionalMetaInsightMaybe(path, metricName, token = metaBaseToken()) {
  try {
    const insights = await metaGet(path, { metric: metricName }, token);
    const item = (insights.data || []).find((x) => x.name === metricName);
    const value = item?.values?.[0]?.value ?? item?.total_value?.value;
    return value == null ? null : num(value);
  } catch {
    return null;
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
  applyMetaDailyValues(daily, views, 'views');
  return {
    hasReach: false,
    viewsMetric: views?.name || '',
    reachMetric: '',
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
  let businessSuiteDailyCount = 0;
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

  businessSuiteDailyCount = await applyInstagramBusinessSuiteDailyTotals(daily, token);

  return {
    metric: {
      platform: 'instagram',
      handle,
      source: 'live',
      provider: businessSuiteDailyCount
        ? 'meta-ig-user-insights-api:daily-range-totals'
        : (accountInsightSummary?.viewsMetric ? `meta-ig-user-insights-api:${accountInsightSummary.viewsMetric}` : 'meta-media-insights-api'),
      businessSuiteDailyCount,
      hasWatchTime: false,
      hasReach: accountInsightSummary ? accountInsightSummary.hasReach : true,
      reachUnavailableReason: accountInsightSummary && !accountInsightSummary.hasReach ? 'Current Instagram account insight fallback did not provide reach.' : '',
      postProvider: 'meta-ig-media',
      postDefinition: 'Published Instagram media posts and Reels returned by the Instagram media edge. Stories are not included.',
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
    { metrics: ['page_media_view'], params: { metric_type: 'total_value' } },
    { metrics: ['page_total_media_view'], params: { metric_type: 'total_value' } },
    ['page_media_view'],
    ['page_total_media_view'],
    ['page_posts_impressions'],
    ['page_impressions'],
    ['page_views_total'],
    ['page_video_views'],
  ], token, 'Facebook page insights');
  const pageInsightSummary = applyFacebookPageInsights(daily, pageInsights);
  const pageViewsOnly = pageInsightSummary.viewsMetric === 'page_views_total';
  const hasFacebookContentViews = ['page_media_view', 'page_total_media_view'].includes(pageInsightSummary.viewsMetric);
  const postCountSummary = await applyFacebookPublishedPostCounts(daily, token);
  const postInsightSummary = await hydrateFacebookPostInsights(postCountSummary.posts || [], token);
  for (const item of postCountSummary.posts || []) {
    content.push(facebookPostContent(item));
  }

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
        hasReach: false,
        reachUnavailableReason: 'Facebook does not expose a supported content reach metric through the public Meta API. Business Suite Viewers is not the same calculation as Meta Page Insights unique media views.',
        postProvider: postCountSummary.provider,
        postInsightProvider: postInsightSummary.provider,
        postViewsFound: postInsightSummary.viewsFound,
        postDefinition: 'Published Facebook Page posts returned by the Page published_posts edge. Stories are not included.',
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
      hasReach: false,
      reachUnavailableReason: 'Facebook does not expose a supported content reach metric through the public Meta API. Business Suite Viewers is not the same calculation as Meta Page Insights unique media views.',
      postProvider: postCountSummary.provider,
      postInsightProvider: postInsightSummary.provider,
      postViewsFound: postInsightSummary.viewsFound,
      postDefinition: 'Published Facebook Page posts returned by the Page published_posts edge. Stories are not included.',
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
      hasReach: false,
      reachUnavailableReason: 'Facebook does not expose a supported content reach metric through the public Meta API. Business Suite Viewers is not the same calculation as Meta Page Insights unique media views.',
      asOf: ASOF,
      daily: toArr(daily),
    },
    content,
  };
}

async function applyFacebookPublishedPostCounts(daily, token) {
  const { id } = ACCT.facebook;
  const fullFields = [
    'id', 'created_time', 'permalink_url', 'message', 'status_type',
    'attachments{media_type,type}', 'shares', 'reactions.summary(true)',
    'comments.summary(true)', 'insights.metric(post_impressions,post_video_views,post_impressions_unique)',
  ].join(',');
  const basicFields = [
    'id', 'created_time', 'permalink_url', 'message', 'status_type',
    'attachments{media_type,type}', 'shares',
  ].join(',');
  const postListFields = 'id,created_time,permalink_url,message,status_type';
  const minimalFields = 'id,created_time';
  const endpoints = ['published_posts', 'posts'];
  let lastError = null;

  for (const endpoint of endpoints) {
    for (const [fieldLabel, fields] of [['with-insights', fullFields], ['basic', basicFields], ['post-list', postListFields], ['minimal', minimalFields]]) {
      const seen = new Set();
      const posts = [];
      const countsByDate = new Map();
      try {
        for (let chunkStart = START; chunkStart <= END; chunkStart = addDays(chunkStart, 30)) {
          const chunkEnd = minIso(addDays(chunkStart, 29), END);
          const chunk = await metaPaged(
            `/${id}/${endpoint}`,
            { fields, limit: 100, since: unixDay(chunkStart), until: unixDay(chunkEnd, true) },
            null,
            token
          );
          for (const post of chunk) {
            if (!post.id || seen.has(post.id)) continue;
            const date = dateOnly(post.created_time);
            if (!inAxis(date)) continue;
            seen.add(post.id);
            posts.push(post);
            countsByDate.set(date, (countsByDate.get(date) || 0) + 1);
          }
        }
        for (const [date, count] of countsByDate) daily.get(date).posts += count;
        console.log(`  - Facebook post counts: ${seen.size} published posts from /${endpoint} (${fieldLabel}).`);
        return { count: seen.size, provider: `meta-page-${endpoint}:${fieldLabel}`, posts };
      } catch (err) {
        lastError = err;
        console.warn(`  - Facebook post count via /${endpoint} (${fieldLabel}) unavailable: ${err.message}`);
      }
    }
  }

  console.warn(`  - Facebook post counts unavailable: ${lastError?.message || 'unknown error'}`);
  return { count: 0, provider: 'unavailable', posts: [] };
}

async function hydrateFacebookPostInsights(posts, token) {
  let viewsFound = 0;
  let source = '';
  const limit = 8;

  const hydrate = async (post) => {
    if (!post.id) return;
    const path = `/${post.id}/insights`;
    const currentViews = await optionalMetaInsightMaybe(path, 'views', token);
    const videoViews = currentViews == null ? await optionalMetaInsightMaybe(path, 'post_video_views', token) : null;
    const impressions = currentViews == null && videoViews == null ? await optionalMetaInsightMaybe(path, 'post_impressions', token) : null;
    const views = currentViews ?? videoViews ?? impressions;

    if (views != null) {
      post._dashboardViews = views;
      post._dashboardViewsSource = currentViews != null ? 'views' : (videoViews != null ? 'post_video_views' : 'post_impressions');
      source ||= post._dashboardViewsSource;
      viewsFound += 1;
    }
  };

  for (let i = 0; i < posts.length; i += limit) {
    await Promise.all(posts.slice(i, i + limit).map(hydrate));
  }

  if (posts.length) {
    console.log(`  - Facebook post insights: views found for ${viewsFound}/${posts.length} posts${source ? ` via ${source}` : ''}.`);
  }
  return {
    provider: viewsFound ? `meta-post-insights:${source || 'mixed'}` : 'meta-post-insights:unavailable',
    viewsFound,
  };
}

function facebookPostType(post) {
  const s = `${post.status_type || ''} ${post.attachments?.data?.[0]?.media_type || ''} ${post.attachments?.data?.[0]?.type || ''}`.toLowerCase();
  if (s.includes('video')) return 'Short Form Clip';
  if (s.includes('album') || s.includes('carousel')) return 'Carousel';
  if (s.includes('photo') || s.includes('image')) return 'Single Image';
  return 'Text Post';
}

function facebookPostContent(post) {
  const insights = post.insights || { data: [] };
  const impressions = insightValue(insights, ['post_impressions']);
  const videoViews = insightValue(insights, ['post_video_views']);
  const reach = insightValue(insights, ['post_impressions_unique']);
  const views = post._dashboardViews ?? (videoViews || impressions || null);
  return {
    platform: 'facebook',
    date: dateOnly(post.created_time),
    url: post.permalink_url || '',
    title: caption(post.message),
    type: facebookPostType(post),
    views,
    reach,
    eng: num(post.reactions?.summary?.total_count) + num(post.comments?.summary?.total_count) + num(post.shares?.count),
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

function recentCompleteDays(weekCount = 4) {
  return completeFriThuWeeks(weekCount).flatMap((week) => {
    const days = [];
    for (let date = week.start; date <= week.end; date = addDays(date, 1)) days.push(date);
    return days;
  });
}

async function applyInstagramBusinessSuiteDailyTotals(daily, token) {
  let applied = 0;
  for (const date of recentCompleteDays(4)) {
    const views = await optionalMetaRangeTotal(`/${ACCT.instagram.id}/insights`, [
      { metrics: ['content_views'], params: { metric_type: 'total_value' } },
      { metrics: ['views'], params: { metric_type: 'total_value' } },
    ], date, date, token, 'Instagram Business Suite daily views');
    const reach = await optionalMetaRangeTotal(`/${ACCT.instagram.id}/insights`, [
      { metrics: ['reach'], params: { metric_type: 'total_value' } },
    ], date, date, token, 'Instagram Business Suite daily reach');
    const row = daily.get(date);
    if (!row) continue;
    if (views?.value != null) {
      row.views = views.value;
      applied += 1;
    }
    if (reach?.value != null) row.reach = reach.value;
  }
  if (applied) console.log(`  - Applied Instagram Business Suite daily totals for ${applied} recent days.`);
  return applied;
}

async function buildMetaRangeOverrides() {
  const token = metaBaseToken();
  if (!token) return [];
  const pageToken = await metaPageToken();
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
    if (fbViews?.value != null) {
      overrides.push({
        platform: 'facebook',
        ...range,
        source: `Meta API range totals (${fbViews.metric})`,
        values: {
          ...(fbViews?.value != null ? { views: fbViews.value } : {}),
        },
      });
    }
  }
  return overrides;
}

async function googleAccessToken() {
  const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN } = process.env;
  if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REFRESH_TOKEN) {
    throw new Error('YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, and YOUTUBE_REFRESH_TOKEN are required');
  }
  try {
    const json = await postForm('https://oauth2.googleapis.com/token', {
      client_id: YOUTUBE_CLIENT_ID,
      client_secret: YOUTUBE_CLIENT_SECRET,
      refresh_token: YOUTUBE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    });
    return json.access_token;
  } catch (err) {
    if (/expired|revoked|invalid_grant/i.test(err.message)) {
      throw new Error('YouTube refresh token expired or was revoked; reconnect YouTube OAuth and update YOUTUBE_REFRESH_TOKEN');
    }
    throw err;
  }
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

  const dailyTotals = await youtubeAnalytics(token, {
    ids: 'channel==MINE',
    startDate: START,
    endDate: END,
    metrics: 'views,estimatedMinutesWatched',
    dimensions: 'day',
    sort: 'day',
    maxResults: '10000',
  });
  for (const row of dailyTotals.rows || []) {
    const [date, views, watchTime] = row;
    if (!inAxis(date)) continue;
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
  const videoAnalytics = new Map();
  if (videos.length) {
    try {
      const videoTotals = await youtubeAnalytics(token, {
        ids: 'channel==MINE',
        startDate: START,
        endDate: END,
        metrics: 'views,estimatedMinutesWatched',
        dimensions: 'video',
        filters: `video==${videos.map((v) => v.id).join(',')}`,
        maxResults: '10000',
      });
      for (const row of videoTotals.rows || []) {
        const [videoId, views, watchTime] = row;
        videoAnalytics.set(videoId, { views: num(views), watchTime: num(watchTime) });
      }
    } catch (err) {
      console.warn(`  - YouTube per-video analytics unavailable, using public video statistics only: ${err.message}`);
    }
  }
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
      const analytics = videoAnalytics.get(item.id);
      const views = analytics?.views ?? num(item.statistics?.viewCount);
      content.push({
        platform: 'youtube',
        date,
        url: `https://www.youtube.com/watch?v=${item.id}`,
        title: item.snippet?.title || '',
        type: isoDurationSeconds(item.contentDetails?.duration) <= 180 ? 'Short Form Clip' : 'Video',
        views,
        watchTime: analytics?.watchTime ?? null,
        reach: null,
        eng: num(item.statistics?.likeCount) + num(item.statistics?.commentCount),
      });
    }
  }

  return {
    metric: {
      platform: 'youtube',
      handle,
      source: 'live',
      provider: 'youtube-analytics-api:channel-daily-totals',
      hasWatchTime: true,
      hasReach: false,
      organicOnly: false,
      postProvider: 'youtube-data-api:uploads-playlist',
      postDefinition: 'Published YouTube uploads from the channel uploads playlist, including Shorts and standard videos.',
      asOf: ASOF,
      daily: toArr(daily),
    },
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
  if (hasTikTokBusinessCreds()) {
    return pullTikTokBusiness();
  }
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

async function tiktokBusinessGet(path, params = {}) {
  const token = process.env.TIKTOK_BUSINESS_ACCESS_TOKEN;
  if (!token) throw new Error('TIKTOK_BUSINESS_ACCESS_TOKEN is required');
  const url = new URL(`https://business-api.tiktok.com/open_api/v1.3/${path.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  const res = await fetchWithTimeout(url.toString(), { headers: { 'Access-Token': token } });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Non-JSON response from ${safeUrl(url)}: ${text.slice(0, 300)}`);
  }
  if (!res.ok || (json.code != null && json.code !== 0)) {
    throw new Error(`${res.status} ${json.message || json.msg || JSON.stringify(json)}`);
  }
  return json;
}

function firstDefined(obj, paths) {
  for (const path of paths) {
    const value = path.split('.').reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
    if (value != null && value !== '') return value;
  }
  return undefined;
}

function tiktokBusinessRows(data) {
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(data?.videos)) return data.videos;
  if (Array.isArray(data?.posts)) return data.posts;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data?.list)) return data.data.list;
  if (Array.isArray(data?.data?.videos)) return data.data.videos;
  return [];
}

function tiktokBusinessDate(item) {
  const raw = firstDefined(item, ['create_time', 'createTime', 'publish_time', 'publishTime', 'create_date', 'date']);
  if (raw == null) return '';
  if (typeof raw === 'number' || /^\d+$/.test(String(raw))) {
    const n = num(raw);
    return ymd(new Date(n > 2_000_000_000 ? n : n * 1000));
  }
  return dateOnly(raw);
}

async function pullTikTokBusiness() {
  const { handle } = ACCT.tiktok;
  const businessId = process.env.TIKTOK_BUSINESS_ID;
  if (!businessId) throw new Error('TIKTOK_BUSINESS_ID is required');
  const daily = emptyDaily();
  const content = [];
  const fields = [
    'item_id',
    'video_id',
    'create_time',
    'share_url',
    'video_url',
    'caption',
    'title',
    'metrics',
    'view_count',
    'like_count',
    'comment_count',
    'share_count',
    'reach',
  ];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= 50) {
    const json = await tiktokBusinessGet('/business/video/list/', {
      business_id: businessId,
      start_date: START,
      end_date: END,
      page,
      page_size: 100,
      fields,
    });
    const data = json.data || {};
    const rows = tiktokBusinessRows(data);
    for (const item of rows) {
      const date = tiktokBusinessDate(item);
      if (!inAxis(date)) continue;
      const views = num(firstDefined(item, ['metrics.views', 'metrics.video_views', 'metrics.view_count', 'video_views', 'view_count']));
      const reach = firstDefined(item, ['metrics.reach', 'reach']);
      const likes = num(firstDefined(item, ['metrics.likes', 'metrics.like_count', 'likes', 'like_count']));
      const comments = num(firstDefined(item, ['metrics.comments', 'metrics.comment_count', 'comments', 'comment_count']));
      const shares = num(firstDefined(item, ['metrics.shares', 'metrics.share_count', 'shares', 'share_count']));
      const b = daily.get(date);
      if (!b) continue;
      b.posts += 1;
      b.views += views;
      if (reach != null) b.reach += num(reach);
      content.push({
        platform: 'tiktok',
        date,
        url: firstDefined(item, ['share_url', 'video_url', 'url']) || '',
        title: caption(firstDefined(item, ['caption', 'title', 'video_title'])),
        type: 'Short Form Clip',
        views,
        reach: reach == null ? null : num(reach),
        eng: likes + comments + shares,
      });
    }
    const pageInfo = data.page_info || data.pageInfo || {};
    hasMore = Boolean(data.has_more || data.hasMore || pageInfo.has_more || pageInfo.hasMore || (pageInfo.total_page && page < num(pageInfo.total_page)));
    page += 1;
  }

  const hasReach = content.some((item) => item.reach != null);
  return {
    metric: {
      platform: 'tiktok',
      handle,
      source: 'live',
      provider: 'tiktok-business-organic-api',
      hasWatchTime: false,
      hasReach,
      reachUnavailableReason: hasReach ? '' : 'TikTok Business Organic API did not return reach for the connected account.',
      asOf: ASOF,
      daily: toArr(daily),
    },
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
    ['tiktok', pullTikTok, hasTikTokBusinessCreds() || hasTikTokDisplayCreds()],
  ]) {
    if (!configured) {
      errors.push(`${name}: credentials not configured`);
      console.warn(`  - ${name}: credentials not configured, carrying forward previous data if available`);
      continue;
    }
    try {
      results[name] = await fn();
      const postTotal = (results[name].metric.daily || []).reduce((sum, row) => sum + (row.posts || 0), 0);
      console.log(`  OK ${name}: ${postTotal} posts`);
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
