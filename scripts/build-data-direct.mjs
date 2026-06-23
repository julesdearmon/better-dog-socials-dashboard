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

async function getJson(url, token) {
  const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 300)}`);
  }
  if (!res.ok || body.error) {
    const msg = body.error?.message || body.error_description || JSON.stringify(body.error || body);
    throw new Error(`${res.status} ${msg}`);
  }
  return body;
}

async function postForm(url, body) {
  const res = await fetch(url, {
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
  const res = await fetch(url, {
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

async function pullInstagram() {
  const token = metaBaseToken();
  if (!token) throw new Error('META_USER_ACCESS_TOKEN, META_PAGE_ACCESS_TOKEN, or META_ACCESS_TOKEN is required');
  const { id, handle } = ACCT.instagram;
  const daily = emptyDaily();
  const content = [];
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
    b.views += views;
    b.reach += reach;
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
    metric: { platform: 'instagram', handle, source: 'live', provider: 'meta-graph-api', hasWatchTime: false, asOf: ASOF, daily: toArr(daily) },
    content,
  };
}

async function pullFacebook() {
  const token = await metaPageToken();
  const { id, handle } = ACCT.facebook;
  const daily = emptyDaily();
  const content = [];
  const fields = [
    'id',
    'created_time',
    'permalink_url',
    'message',
    'status_type',
    'attachments{media_type,type}',
    'shares',
    'comments.summary(true)',
    'reactions.summary(true)',
  ].join(',');
  const posts = await metaPaged(
    `/${id}/published_posts`,
    { fields, limit: 100 },
    (item) => dateOnly(item.created_time) < START,
    token
  );

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
    const insights = await metaInsights(`/${post.id}/insights`, [
      ['post_impressions', 'post_impressions_unique', 'post_video_views'],
      ['post_impressions', 'post_impressions_unique'],
    ], token);
    const impressions = insightValue(insights, ['post_impressions']);
    const videoViews = insightValue(insights, ['post_video_views']);
    const views = videoViews || impressions;
    const reach = insightValue(insights, ['post_impressions_unique']);
    const eng = num(post.reactions?.summary?.total_count) + num(post.comments?.summary?.total_count) + num(post.shares?.count);
    const b = daily.get(date);
    b.posts += 1;
    b.views += views;
    b.reach += reach;
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
    metric: { platform: 'facebook', handle, source: 'live', provider: 'meta-graph-api', hasWatchTime: false, asOf: ASOF, daily: toArr(daily) },
    content,
  };
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
    ids: `channel==${id}`,
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

  const channel = await youtubeData(token, 'channels', { part: 'contentDetails', id });
  const uploads = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error(`No uploads playlist found for channel ${id}`);

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
  const data = {
    client: previous?.client || { id: 'better-dog-supplements', name: 'Better Dog Supplements', color: '#88cc33' },
    asOf: ASOF,
    updatedAt: friendlyStamp(),
    source: 'live',
    generatedFrom: `Direct APIs (${Object.keys(results).join(', ')})${carried.length ? `; carried forward: ${carried.join(', ')}` : ''}`,
    directApiErrors: errors,
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
