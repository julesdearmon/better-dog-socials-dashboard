#!/usr/bin/env node
/**
 * Better Dog Supplements — social dashboard data builder.
 *
 * Pulls REAL metrics from the Supermetrics Query API and rebuilds the dashboard's
 * data files (public/data.json + public/realdata.js). This is the server-side
 * replacement for the in-Claude Supermetrics MCP connector, so it can run
 * unattended in GitHub Actions with no app open and no connector to reconnect.
 *
 * Logic is a faithful port of:
 *   .claude/scheduled-tasks/refresh-better-dog-dashboard/SKILL.md
 * (organic-only YouTube, first-sentence captions, Fri–Thu summary, full schema).
 *
 * Requires Node 18+ (global fetch). Env:
 *   SUPERMETRICS_API_KEY  (required) — Query API key.
 *   DISPLAY_TZ            (optional) — IANA tz for the "last updated" stamp.
 *                                      Default America/New_York.
 *   WINDOW_DAYS          (optional) — days of history to pull. Default 300.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '..', 'public');

const API_KEY = process.env.SUPERMETRICS_API_KEY;
const ENDPOINT = 'https://api.supermetrics.com/enterprise/v2/query/data/json';
const DISPLAY_TZ = process.env.DISPLAY_TZ || 'America/New_York';
const WINDOW_DAYS = Number(process.env.WINDOW_DAYS || 300);

if (!API_KEY) {
  console.error('FATAL: SUPERMETRICS_API_KEY is not set. Add it as a GitHub Actions secret.');
  process.exit(1);
}

// ---------- accounts (from SKILL.md / project handoff) ----------
const ACCT = {
  instagram: { ds_id: 'IGI', account: '17841475238822164', handle: '@betterdogsupplements' },
  facebook:  { ds_id: 'FB',  account: '674626722402999',   handle: 'Better Dog Supplements' },
  youtube:   { ds_id: 'YT2', account: 'UC9rUabwMqe2C98J2l1NDz2g', handle: 'Better Dog Supplements' },
  tiktok:    { ds_id: 'TIKBA', account: 'betterdogsupplements', handle: '@betterdogsupplements' },
};

// ---------- date helpers ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dateOnly = (s) => (s == null ? '' : String(s).slice(0, 10)); // "2026-06-21T..." -> "2026-06-21"

const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const yesterday = new Date(today); yesterday.setUTCDate(today.getUTCDate() - 1);
const start = new Date(today); start.setUTCDate(today.getUTCDate() - WINDOW_DAYS);

const ASOF = ymd(today);
const START = ymd(start);
const END = ymd(yesterday);

// full zero-fill axis: START..END inclusive
function axisDates() {
  const out = [];
  const d = new Date(start);
  while (ymd(d) <= END) { out.push(ymd(d)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
const AXIS = axisDates();
const inAxis = (date) => date >= START && date <= END;

// friendly local stamp, e.g. "Jun 22, 2026, 1:59 PM"
function friendlyStamp() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TZ,
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(now);
}

// ---------- Supermetrics Query API ----------
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * Run one Supermetrics query. Returns an array of plain objects keyed by `fields`.
 * fields: array of field names (sent as a comma-joined string).
 */
async function query({ ds_id, account, fields, settings }) {
  const body = {
    api_key: API_KEY,
    ds_id,
    ds_accounts: account,
    date_range_type: 'custom',
    start_date: START,
    end_date: END,
    fields: fields.join(','),
    max_rows: 10000,
  };
  if (settings) body.settings = settings;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supermetrics ${ds_id} ${res.status}: ${text.slice(0, 500)}`);
  }
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`${ds_id}: non-JSON response: ${text.slice(0, 300)}`); }

  // v2 returns { data: [ [headerRow?], [row], ... ] }. Map rows to objects by field order,
  // dropping a leading header row if the API included one.
  let rows = Array.isArray(json?.data) ? json.data : [];
  if (rows.length && Array.isArray(rows[0])) {
    const first = rows[0].map((c) => String(c).toLowerCase());
    const looksHeader = first.some((cell) =>
      fields.map((f) => f.toLowerCase()).includes(cell) ||
      /date|views?|reach|posts?|media|video|likes?|comments?|minutes?|link|type|caption|message|id/.test(cell)
    );
    if (looksHeader) rows = rows.slice(1);
    return rows.map((r) => Object.fromEntries(fields.map((f, i) => [f, r[i]])));
  }
  // some deployments return array of objects already
  return rows;
}

async function queryRange({ ds_id, account, fields, settings, start_date = START, end_date = END }) {
  const body = {
    api_key: API_KEY,
    ds_id,
    ds_accounts: account,
    date_range_type: 'custom',
    start_date,
    end_date,
    fields: fields.join(','),
    max_rows: 10000,
  };
  if (settings) body.settings = settings;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Supermetrics ${ds_id} ${res.status}: ${text.slice(0, 500)}`);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`${ds_id}: non-JSON response: ${text.slice(0, 300)}`); }

  let rows = Array.isArray(json?.data) ? json.data : [];
  if (rows.length && Array.isArray(rows[0])) {
    const first = rows[0].map((c) => String(c).toLowerCase());
    const fieldNames = fields.map((f) => f.toLowerCase());
    const looksHeader = first.some((cell) =>
      fieldNames.includes(cell) ||
      /date|views?|reach|posts?|media|video|likes?|comments?|minutes?|link|type|caption|message|id/.test(cell)
    );
    if (looksHeader) rows = rows.slice(1);
    return rows.map((r) => Object.fromEntries(fields.map((f, i) => [f, r[i]])));
  }
  return rows;
}

// ---------- caption -> first sentence (port of SKILL CAPTION()) ----------
function caption(text) {
  if (!text) return '';
  const s = String(text).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // first . ! ? or … (plus trailing closing quote/bracket) followed by space or end
  const m = s.match(/^[\s\S]*?[.!?…]["'”’")\]]?(?=\s|$)/);
  let out = m ? m[0].trim() : s;
  if (out.length > 180) {
    const cut = out.slice(0, 180);
    const sp = cut.lastIndexOf(' ');
    out = (sp > 80 ? cut.slice(0, sp) : cut).trim() + '…';
  }
  return out;
}

// ---------- daily series scaffolding ----------
function emptyDaily() {
  const map = new Map();
  for (const d of AXIS) map.set(d, { date: d, posts: 0, views: 0, reach: 0, watchTime: 0 });
  return map;
}
const toArr = (map) => AXIS.map((d) => map.get(d));

// =====================================================================
// PLATFORM PULLS
// =====================================================================

async function pullInstagram() {
  const { ds_id, account, handle } = ACCT.instagram;
  const dailyRows = await queryRange({ ds_id, account, fields: ['date', 'profile_views', 'reach'] });
  const rows = await queryRange({
    ds_id,
    account,
    fields: ['timestamp', 'media_id', 'media_permalink', 'media_type', 'media_caption',
      'media_views', 'media_reach', 'media_like_count', 'media_comments_count'],
  });
  const daily = emptyDaily();
  const content = [];
  const typeOf = (t) => (t === 'VIDEO' ? 'Short Form Clip' : t === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Single Image');
  for (const r of dailyRows) {
    const date = dateOnly(r.date);
    if (!inAxis(date)) continue;
    const b = daily.get(date);
    b.views += num(r.profile_views);
    b.reach += num(r.reach);
  }
  for (const r of rows) {
    const date = dateOnly(r.timestamp);
    if (!inAxis(date)) continue;
    const b = daily.get(date);
    b.posts += 1;
    content.push({
      platform: 'instagram', date, url: r.media_permalink || '',
      title: caption(r.media_caption), type: typeOf(r.media_type),
      views: num(r.media_views), reach: num(r.media_reach),
      eng: num(r.media_like_count) + num(r.media_comments_count),
    });
  }
  return {
    metric: { platform: 'instagram', handle, source: 'live', hasWatchTime: false, asOf: ASOF, daily: toArr(daily) },
    content,
  };
}

async function pullFacebook() {
  const { ds_id, account, handle } = ACCT.facebook;
  const settings = { include_all_published_posts: true };
  const dailyRows = await queryRange({
    ds_id,
    account,
    fields: ['date', 'page_media_view', 'page_total_media_view_unique', 'page_post_engagements'],
  });
  const rows = await queryRange({
    ds_id,
    account,
    fields: ['date', 'post_ID', 'post_linkto', 'post_type', 'post_message',
      'post_media_views', 'post_total_media_views_unique', 'post_reactions_total', 'post_comments_on_post'],
    settings,
  });
  const daily = emptyDaily();
  const content = [];
  const typeOf = (t) => {
    const s = String(t || '').toLowerCase();
    if (s.includes('video')) return 'Short Form Clip';
    if (s.includes('album')) return 'Carousel';
    if (s.includes('photo') || s.includes('profile_media') || s.includes('cover')) return 'Single Image';
    return 'Text Post';
  };
  for (const r of dailyRows) {
    const date = dateOnly(r.date);
    if (!inAxis(date)) continue;
    const b = daily.get(date);
    b.views += num(r.page_media_view);
    b.reach += num(r.page_total_media_view_unique);
  }
  for (const r of rows) {
    const date = dateOnly(r.date);
    if (!inAxis(date)) continue;
    const b = daily.get(date);
    b.posts += 1;
    content.push({
      platform: 'facebook', date, url: r.post_linkto || '',
      title: caption(r.post_message), type: typeOf(r.post_type),
      views: num(r.post_media_views), reach: num(r.post_total_media_views_unique),
      eng: num(r.post_reactions_total) + num(r.post_comments_on_post),
    });
  }
  return {
    metric: { platform: 'facebook', handle, source: 'live', hasWatchTime: false, asOf: ASOF, daily: toArr(daily) },
    content,
  };
}

async function pullYouTube() {
  const { ds_id, account, handle } = ACCT.youtube;
  const daily = emptyDaily();

  // ORGANIC ONLY: TrafficSources, sum every source EXCEPT ADVERTISING.
  const ts = await queryRange({
    ds_id, account,
    settings: { report_type: 'ChannelTotals' },
    fields: ['date', 'views', 'estimatedMinutesWatched'],
  });
  for (const r of ts) {
    const date = dateOnly(r.date);
    if (!inAxis(date)) continue;
    const b = daily.get(date);
    b.views += num(r.views); b.watchTime += num(r.estimatedMinutesWatched);
  }

  // posts + content from LatestVideos (per-video views still include ad views — known limitation)
  const vids = await queryRange({
    ds_id, account,
    settings: { report_type: 'LatestVideos' },
    fields: ['video_published_date', 'video_url', 'video_title', 'video_length',
      'views', 'estimatedMinutesWatched', 'likes', 'comments'],
  });
  const content = [];
  const isShort = (len) => {
    const m = String(len || '').match(/(\d+):(\d+):(\d+)/);
    if (!m) return false;
    return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) <= 180;
  };
  for (const r of vids) {
    const date = dateOnly(r.video_published_date);
    if (!inAxis(date)) continue;
    daily.get(date).posts += 1;
    content.push({
      platform: 'youtube', date, url: r.video_url || '',
      title: r.video_title || '', // YouTube keeps its real title (no CAPTION)
      type: isShort(r.video_length) ? 'Short Form Clip' : 'Video',
      views: num(r.views), watchTime: num(r.estimatedMinutesWatched), reach: null,
      eng: num(r.likes) + num(r.comments),
    });
  }
  return {
    metric: { platform: 'youtube', handle, source: 'live', hasWatchTime: true, hasReach: false, organicOnly: false, asOf: ASOF, daily: toArr(daily) },
    content,
  };
}

async function pullTikTok() {
  throw new Error('TikTok is pending API approval and is intentionally excluded from live totals');
  const { ds_id, account, handle } = ACCT.tiktok;
  const settings = { report_type: 'videos' };
  const fields = ['videos__create_date', 'videos__video_views', 'videos__reach',
    'videos__share_url', 'videos__caption', 'videos__likes', 'videos__comments'];
  const rows = await query({ ds_id, account, fields, settings });
  const daily = emptyDaily();
  const content = [];
  for (const r of rows) {
    const date = dateOnly(r.videos__create_date);
    if (!inAxis(date)) continue;
    const b = daily.get(date);
    b.posts += 1; b.views += num(r.videos__video_views); b.reach += num(r.videos__reach);
    content.push({
      platform: 'tiktok', date,
      url: String(r.videos__share_url || '').split('?')[0], // strip ?utm…
      title: caption(r.videos__caption), type: 'Short Form Clip',
      views: num(r.videos__video_views), reach: num(r.videos__reach),
      eng: num(r.videos__likes) + num(r.videos__comments),
    });
  }
  return {
    metric: { platform: 'tiktok', handle, source: 'live', hasWatchTime: false, hasReach: true, asOf: ASOF, daily: toArr(daily) },
    content,
  };
}

function completeFriThuWeeks(count = 4) {
  const end = new Date(`${END}T00:00:00Z`);
  const back = (end.getUTCDay() - 4 + 7) % 7;
  const thu = new Date(end);
  thu.setUTCDate(end.getUTCDate() - back);
  const ranges = [];
  for (let i = 0; i < count; i += 1) {
    const hi = new Date(thu);
    hi.setUTCDate(thu.getUTCDate() - i * 7);
    const lo = new Date(hi);
    lo.setUTCDate(hi.getUTCDate() - 6);
    ranges.push({ start: ymd(lo), end: ymd(hi) });
  }
  return ranges;
}

async function buildSupermetricsRangeOverrides() {
  const overrides = [];
  for (const range of completeFriThuWeeks(4)) {
    const [ig] = await queryRange({
      ds_id: ACCT.instagram.ds_id,
      account: ACCT.instagram.account,
      start_date: range.start,
      end_date: range.end,
      fields: ['profile_views', 'reach'],
    });
    if (ig) {
      overrides.push({
        platform: 'instagram',
        ...range,
        source: 'Supermetrics exact range total',
        values: { views: num(ig.profile_views), reach: num(ig.reach) },
      });
    }

    const [fb] = await queryRange({
      ds_id: ACCT.facebook.ds_id,
      account: ACCT.facebook.account,
      start_date: range.start,
      end_date: range.end,
      fields: ['page_media_view', 'page_total_media_view_unique'],
    });
    if (fb) {
      overrides.push({
        platform: 'facebook',
        ...range,
        source: 'Supermetrics exact range total',
        values: { views: num(fb.page_media_view) },
      });
    }

    const [yt] = await queryRange({
      ds_id: ACCT.youtube.ds_id,
      account: ACCT.youtube.account,
      start_date: range.start,
      end_date: range.end,
      settings: { report_type: 'ChannelTotals' },
      fields: ['views', 'estimatedMinutesWatched'],
    });
    if (yt) {
      overrides.push({
        platform: 'youtube',
        ...range,
        source: 'Supermetrics exact range total',
        values: { views: num(yt.views), watchTime: num(yt.estimatedMinutesWatched) },
      });
    }
  }
  return overrides;
}

// =====================================================================
// BUILD
// =====================================================================

// latest completed Fri–Thu week summary (Fri=5 .. Thu=4)
function weekSummary(metrics) {
  // find most recent Thursday <= END
  const end = new Date(`${END}T00:00:00Z`);
  const back = (end.getUTCDay() - 4 + 7) % 7; // days since Thursday
  const thu = new Date(end); thu.setUTCDate(end.getUTCDate() - back);
  const fri = new Date(thu); fri.setUTCDate(thu.getUTCDate() - 6);
  const lo = ymd(fri), hi = ymd(thu);
  const sum = { posts: 0, views: 0, reach: 0, watch: 0 };
  for (const p of Object.values(metrics)) {
    for (const d of p.daily) {
      if (d.date >= lo && d.date <= hi) {
        sum.posts += d.posts; sum.views += d.views; sum.reach += d.reach; sum.watch += d.watchTime || 0;
      }
    }
  }
  return { lo, hi, sum };
}

async function main() {
  console.log(`Pulling Supermetrics ${START} → ${END} (asOf ${ASOF})`);
  const results = {};
  const errors = [];
  const requiredSources = ['instagram', 'facebook', 'youtube'];
  for (const [name, fn] of [
    ['instagram', pullInstagram], ['facebook', pullFacebook],
    ['youtube', pullYouTube], ['tiktok', pullTikTok],
  ]) {
    try {
      results[name] = await fn();
      const m = results[name].metric;
      console.log(`  ✓ ${name}: ${results[name].content.length} posts`);
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
      console.error(`  ✗ ${name} FAILED: ${e.message}`);
    }
  }

  const failedRequired = requiredSources.filter((name) => !results[name]);
  if (failedRequired.length) {
    console.error(`FATAL: required Supermetrics source(s) failed: ${failedRequired.join(', ')}. Not writing files.`);
    console.error(errors.join('\n'));
    process.exit(1);
  }

  const metrics = {};
  let content = [];
  for (const [name, r] of Object.entries(results)) {
    metrics[name] = r.metric;
    content = content.concat(r.content);
  }
  if (!metrics.tiktok) {
    metrics.tiktok = {
      platform: 'tiktok',
      handle: ACCT.tiktok.handle,
      source: 'pending',
      provider: 'pending-api-approval',
      carriedForward: true,
      hasWatchTime: false,
      hasReach: false,
      asOf: ASOF,
      daily: toArr(emptyDaily()),
    };
  }
  const rangeOverrides = await buildSupermetricsRangeOverrides();

  const data = {
    client: { id: 'better-dog-supplements', name: 'Better Dog Supplements', color: '#88cc33' },
    asOf: ASOF,
    updatedAt: friendlyStamp(),
    source: 'live',
    generatedFrom: 'Supermetrics API (Instagram, Facebook, YouTube); TikTok pending',
    directApiErrors: errors.filter((x) => !/^tiktok:/i.test(x)),
    rangeOverrides,
    metrics,
    content,
  };

  mkdirSync(PUBLIC_DIR, { recursive: true });
  const json = JSON.stringify(data, null, 2);
  writeFileSync(resolve(PUBLIC_DIR, 'data.json'), json + '\n');
  writeFileSync(
    resolve(PUBLIC_DIR, 'realdata.js'),
    `// Real data embedded for file:// usage; loaded by app.js as window.REAL_DATA.\nwindow.REAL_DATA = ${json};\n`
  );

  const { lo, hi, sum } = weekSummary(metrics);
  console.log(`Wrote data.json + realdata.js. Latest Fri–Thu week ${lo}…${hi}: ` +
    `${sum.posts} posts / ${sum.views.toLocaleString()} views / ${sum.reach.toLocaleString()} reach / ` +
    `${Math.round(sum.watch / 60)} hrs YT watch. ${content.length} content records.`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
