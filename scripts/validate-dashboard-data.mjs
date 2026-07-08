#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('public/data.json', 'utf8'));
const config = JSON.parse(readFileSync('config/data-sources.json', 'utf8'));
const summary = JSON.parse(readFileSync('logs/latest-refresh-summary.json', 'utf8'));
const requiredPlatforms = Object.keys(config.platforms || {});
const generatedFrom = String(data.generatedFrom || '');
const problems = [];
const DAY = 86400000;

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
function defaultRange(asOf) {
  const base = Date.parse(`${asOf}T00:00:00Z`);
  const d = new Date(base);
  const start = base - ((d.getUTCDay() - 5 + 7) % 7) * DAY;
  return { start: iso(start), end: asOf };
}
function priorRange(range) {
  const start = Date.parse(`${range.start}T00:00:00Z`);
  const end = Date.parse(`${range.end}T00:00:00Z`);
  const lenDays = Math.round((end - start) / DAY) + 1;
  const priorEnd = start - DAY;
  return { start: iso(priorEnd - (lenDays - 1) * DAY), end: iso(priorEnd) };
}
function findRangeOverride(platform, range) {
  return (data.rangeOverrides || []).find((r) => r.platform === platform && r.start === range.start && r.end === range.end);
}
const sumRows = (rows, field) => rows.reduce((sum, row) => sum + Number(row[field] || 0), 0);
const rowsInRange = (rows, range) => (rows || []).filter((row) => row.date >= range.start && row.date <= range.end);

if (config.sourceOfTruth !== 'supermetrics-chatgpt-codex-connector') problems.push('config sourceOfTruth is not the Supermetrics connector');
if (config.standaloneSupermetricsRestApi?.enabled) problems.push('standalone Supermetrics REST API is enabled in config');
if (data.source !== 'live') problems.push('dashboard source is not live');
if (!data.asOf) problems.push('missing asOf date');
if (!data.updatedAt) problems.push('missing updatedAt timestamp');
if (/direct|meta api|youtube api|carried/i.test(generatedFrom)) problems.push(`generatedFrom mentions an old source: ${generatedFrom}`);

for (const platform of requiredPlatforms) {
  const platformConfig = config.platforms[platform] || {};
  const metric = data.metrics?.[platform];
  if (!metric) problems.push(`${platform}: missing metrics`);
  if (!generatedFrom.toLowerCase().includes(platform)) problems.push(`${platform}: missing from generatedFrom`);
  if (metric?.provider !== platformConfig.provider) problems.push(`${platform}: provider is not ${platformConfig.provider}`);
  if (metric?.carriedForward) problems.push(`${platform}: carried-forward data is still enabled`);
  if (!Array.isArray(metric?.daily) || metric.daily.length === 0) problems.push(`${platform}: no daily rows`);
  if (metric?.daily?.at(-1)?.date !== data.asOf) problems.push(`${platform}: latest daily row does not match asOf`);
  for (const field of platformConfig.requiredMetrics || []) {
    const hasAnyValue = metric?.daily?.some((row) => Number(row[field] || 0) > 0);
    if (!hasAnyValue) problems.push(`${platform}: no ${field} values found`);
  }
  if (platform !== 'youtube') {
    for (const row of metric?.daily || []) {
      const isLatestRow = row.date === data.asOf;
      const hasPosts = Number(row.posts || 0) > 0;
      const hasAnyPerformance = ['views', 'reach', 'watchTime'].some((field) => Number(row[field] || 0) > 0);
      if (!isLatestRow && hasPosts && !hasAnyPerformance) {
        problems.push(`${platform}: ${row.date} has posts but no views, reach, or watch time`);
      }
    }
  }
  if (platform === 'tiktok' && metric?.hasTopContent === false && !metric?.topContentUnavailableReason) {
    problems.push('tiktok: top content is disabled without an explanation');
  }
  if (platform === 'tiktok') {
    if (metric?.postProvider !== 'supermetrics-tiktok-organic-video-ids') {
      problems.push('tiktok: post counts must come from Supermetrics TikTok Organic video IDs');
    }
    const recentNonZeroPostRows = (metric?.daily || []).slice(-14).filter((row) => Number(row.posts || 0) > 0);
    if (recentNonZeroPostRows.length >= 10 && recentNonZeroPostRows.every((row) => Number(row.posts || 0) === 1)) {
      problems.push('tiktok: recent post counts look like profile rows; verify against TikTok video IDs');
    }
  }
}

if (data.asOf) {
  const range = defaultRange(data.asOf);
  const comparisonRange = priorRange(range);
  const exactRangeRequirements = {
    instagram: ['views', 'reach'],
    facebook: ['views', 'reach'],
    youtube: ['views', 'watchTime'],
    tiktok: ['views', 'reach'],
  };
  for (const [platform, fields] of Object.entries(exactRangeRequirements)) {
    for (const checkedRange of [range, comparisonRange]) {
      const override = findRangeOverride(platform, checkedRange);
      if (!override) {
        problems.push(`${platform}: missing exact range override for ${checkedRange.start} to ${checkedRange.end}`);
        continue;
      }
      for (const field of fields) {
        if (override.values?.[field] == null) {
          problems.push(`${platform}: exact range override ${checkedRange.start} to ${checkedRange.end} missing ${field}`);
        }
      }
    }
  }

  for (const platform of requiredPlatforms) {
    const metric = data.metrics?.[platform];
    if (!metric || metric.hasTopContent === false) continue;
    const posts = sumRows(rowsInRange(metric.daily, range), 'posts');
    const contentRows = (data.content || []).filter((item) => item.platform === platform && item.date >= range.start && item.date <= range.end);
    if (posts > 0 && contentRows.length < posts) {
      problems.push(`${platform}: default range has ${posts} posts but only ${contentRows.length} content rows`);
    }
  }

  const ytRows = rowsInRange(data.metrics?.youtube?.daily, range);
  const ytContent = (data.content || []).filter((item) => item.platform === 'youtube' && item.date >= range.start && item.date <= range.end);
  const ytDailyViews = sumRows(ytRows, 'views');
  const ytContentViews = sumRows(ytContent, 'views');
  if (ytContentViews > 0 && ytDailyViews === 0) {
    problems.push(`youtube: default range ${range.start} to ${range.end} has content views but zero channel views`);
  }
  const publicSupplement = (data.content || []).filter((item) =>
    item.platform === 'youtube' &&
    /public (channel )?feed|page supplement/i.test(String(item.source || item.sourceNote || '')) &&
    !item.metricsPending
  );
  if (publicSupplement.length) {
    problems.push(`youtube: ${publicSupplement.length} public supplement content rows remain; use Supermetrics connector-verified rows`);
  }
}

if ((data.directApiErrors || []).length) problems.push(`directApiErrors is not empty: ${data.directApiErrors.length}`);
if (summary.sourceOfTruth !== config.sourceOfTruth) problems.push('refresh summary sourceOfTruth does not match config');
if (summary.dataThrough !== data.asOf) problems.push('refresh summary dataThrough does not match public/data.json asOf');
if (summary.generatedFrom !== data.generatedFrom) problems.push('refresh summary generatedFrom does not match public/data.json');
if ((summary.errors || []).length) problems.push(`refresh summary contains errors: ${summary.errors.length}`);

const updatedMs = Date.parse(String(data.updatedAt).replace(/, ([0-9]{1,2}:[0-9]{2} [AP]M)$/i, ', 2026 $1'));
const today = new Date();
const todayKey = today.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
const dateKeyMs = (key) => {
  const [month, day, year] = key.split('/').map(Number);
  return Date.UTC(year, month - 1, day);
};
if (!Number.isNaN(updatedMs)) {
  const updatedKey = new Date(updatedMs).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  if (updatedKey !== todayKey) {
    const todayStart = dateKeyMs(todayKey);
    const updatedStart = dateKeyMs(updatedKey);
    const daysOld = Math.round((todayStart - updatedStart) / 86400000);
    if (!Number.isFinite(daysOld) || daysOld > 2) problems.push(`updatedAt is stale: ${data.updatedAt}`);
    else console.warn(`Dashboard data was last updated ${daysOld} day${daysOld === 1 ? '' : 's'} ago: ${data.updatedAt}`);
  }
}

if (problems.length) {
  console.error('Dashboard data validation failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(`Dashboard data is valid: ${generatedFrom}`);
