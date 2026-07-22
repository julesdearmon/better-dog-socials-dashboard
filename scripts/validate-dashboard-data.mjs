#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('public/data.json', 'utf8'));
const config = JSON.parse(readFileSync('config/data-sources.json', 'utf8'));
const summary = JSON.parse(readFileSync('logs/latest-refresh-summary.json', 'utf8'));
const realDataSource = readFileSync('public/realdata.js', 'utf8');
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
function lastCompletedWeekRange(asOf) {
  const base = Date.parse(`${asOf}T00:00:00Z`);
  const d = new Date(base);
  const diff = (d.getUTCDay() - 4 + 7) % 7;
  const thu = base - diff * DAY;
  return { start: iso(thu - 6 * DAY), end: iso(thu) };
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
function sameRange(a, b) {
  return a?.start === b?.start && a?.end === b?.end;
}
function rangeKey(range) {
  return `${range.start}..${range.end}`;
}
function uniqueRanges(ranges) {
  const seen = new Set();
  return ranges.filter((range) => {
    const key = rangeKey(range);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function rangeLengthDays(range) {
  return Math.round((Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / DAY) + 1;
}
function dayOfWeek(isoDate) {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`)).getUTCDay();
}
function isFridayThroughThursday(range) {
  return rangeLengthDays(range) === 7 && dayOfWeek(range.start) === 5 && dayOfWeek(range.end) === 4;
}
function rangeNoteText(platform, range, override) {
  const notes = [
    override?.source,
    override?.sourceNote,
    summary.platforms?.[platform]?.note,
  ];
  for (const item of summary.supplementalSources || []) {
    if (item.platform !== platform) continue;
    const text = `${item.key || ''} ${item.note || ''} ${item.source || ''}`;
    if (text.includes(range.start) || text.includes(range.end)) notes.push(text);
  }
  return notes.filter(Boolean).join(' ').toLowerCase();
}
function hasPendingRangeLanguage(text) {
  return /pending|derived|delta|backfill|backfilled|delayed|partial|not yet complete|no data/.test(text);
}
const sumRows = (rows, field) => rows.reduce((sum, row) => sum + Number(row[field] || 0), 0);
const rowsInRange = (rows, range) => (rows || []).filter((row) => row.date >= range.start && row.date <= range.end);
const normalize = (value) => String(value || '').trim().toLowerCase();
const forbiddenAccountPattern = /(?:^|[^a-z])(?:manuel\s+suarez|mrmanuelsuarez)(?:$|[^a-z])/i;
const rangeSourceUsername = (range) => range?.sourceUsername || range?.sourceAccount?.username || range?.account?.username;
function checkForbiddenIdentity(label, values) {
  for (const value of values) {
    if (forbiddenAccountPattern.test(String(value || ''))) {
      problems.push(`${label}: forbidden non-Better-Dog account identity found`);
      return;
    }
  }
}
function addDaysIso(isoDate, days) {
  return iso(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY);
}
function todayIsoInNewYork() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function reportingWeekStart(isoDate) {
  const base = Date.parse(`${isoDate}T00:00:00Z`);
  const d = new Date(base);
  return iso(base - ((d.getUTCDay() - 5 + 7) % 7) * DAY);
}

if (config.sourceOfTruth !== 'supermetrics-chatgpt-codex-connector') problems.push('config sourceOfTruth is not the Supermetrics connector');
if (config.standaloneSupermetricsRestApi?.enabled) problems.push('standalone Supermetrics REST API is enabled in config');
if (data.source !== 'live') problems.push('dashboard source is not live');
if (!data.asOf) problems.push('missing asOf date');
if (!data.updatedAt) problems.push('missing updatedAt timestamp');
if (/direct|meta api|youtube api|carried/i.test(generatedFrom)) problems.push(`generatedFrom mentions an old source: ${generatedFrom}`);

const realDataMatch = realDataSource.match(/^\/\/[^\n]*\nwindow\.REAL_DATA\s*=\s*([\s\S]*);\s*$/);
if (!realDataMatch) {
  problems.push('public/realdata.js is not in the expected generated format');
} else {
  try {
    const realData = JSON.parse(realDataMatch[1]);
    if (JSON.stringify(realData) !== JSON.stringify(data)) {
      problems.push('public/realdata.js does not exactly match public/data.json');
    }
  } catch {
    problems.push('public/realdata.js contains invalid embedded JSON');
  }
}

const todayIso = todayIsoInNewYork();
const latestCompleteDate = addDaysIso(todayIso, -1);
const currentWeekStart = reportingWeekStart(todayIso);
if (data.asOf && data.asOf < latestCompleteDate) {
  problems.push(`data.asOf is stale: ${data.asOf}; expected ${latestCompleteDate}`);
}
if (data.asOf && data.asOf > latestCompleteDate) {
  problems.push(`data.asOf includes a partial current day: ${data.asOf}; expected ${latestCompleteDate}`);
}
if (data.asOf && data.asOf >= currentWeekStart) {
  const currentWeek = { start: currentWeekStart, end: data.asOf };
  const currentWeekViews = requiredPlatforms.reduce((sum, platform) => sum + sumRows(rowsInRange(data.metrics?.[platform]?.daily, currentWeek), 'views'), 0);
  const currentWeekPosts = requiredPlatforms.reduce((sum, platform) => sum + sumRows(rowsInRange(data.metrics?.[platform]?.daily, currentWeek), 'posts'), 0);
  if (currentWeekViews === 0 && currentWeekPosts === 0) {
    problems.push(`current reporting week ${currentWeek.start} to ${currentWeek.end} has zero views and zero posts`);
  }
}

for (const platform of requiredPlatforms) {
  const platformConfig = config.platforms[platform] || {};
  const metric = data.metrics?.[platform];
  if (!metric) problems.push(`${platform}: missing metrics`);
  if (!generatedFrom.toLowerCase().includes(platform)) problems.push(`${platform}: missing from generatedFrom`);
  if (metric?.provider !== platformConfig.provider) problems.push(`${platform}: provider is not ${platformConfig.provider}`);
  const guard = platformConfig.accountGuard || {};
  checkForbiddenIdentity(`${platform} source account`, [
    metric?.handle,
    metric?.sourceAccount?.accountId,
    metric?.sourceAccount?.accountName,
    metric?.sourceAccount?.username,
    metric?.sourceAccount?.handle,
  ]);
  if (guard.expectedMetricHandle && metric?.handle !== guard.expectedMetricHandle) {
    problems.push(`${platform}: metric handle is ${metric?.handle || 'missing'}, expected ${guard.expectedMetricHandle}`);
  }
  if (guard.dsId && metric?.sourceAccount?.dsId !== guard.dsId) {
    problems.push(`${platform}: source account dsId is ${metric?.sourceAccount?.dsId || 'missing'}, expected ${guard.dsId}`);
  }
  if (guard.accountId && metric?.sourceAccount?.accountId !== guard.accountId) {
    problems.push(`${platform}: source account ID is ${metric?.sourceAccount?.accountId || 'missing'}, expected ${guard.accountId}`);
  }
  if (guard.expectedUsername && normalize(metric?.sourceAccount?.username) !== normalize(guard.expectedUsername)) {
    problems.push(`${platform}: source username is ${metric?.sourceAccount?.username || 'missing'}, expected ${guard.expectedUsername}`);
  }
  if (metric?.carriedForward) problems.push(`${platform}: carried-forward data is still enabled`);
  if (!Array.isArray(metric?.daily) || metric.daily.length === 0) problems.push(`${platform}: no daily rows`);
  if (metric?.daily?.at(-1)?.date !== data.asOf) problems.push(`${platform}: latest daily row does not match asOf`);
  for (const row of metric?.daily || []) {
    if (data.asOf && row.date > data.asOf) problems.push(`${platform}: ${row.date} is later than data.asOf ${data.asOf}`);
  }
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
    for (const row of metric?.daily || []) {
      checkForbiddenIdentity(`tiktok daily row ${row.date || 'unknown'}`, [
        row.sourceUsername,
        row.sourceAccount?.username,
        row.sourceAccount?.accountName,
      ]);
      if (normalize(row.sourceUsername) !== normalize(guard.expectedUsername)) {
        problems.push(`tiktok: ${row.date} sourceUsername is ${row.sourceUsername || 'missing'}, expected ${guard.expectedUsername}`);
      }
    }
  }
}

for (const item of data.content || []) {
  const guard = config.platforms?.[item.platform]?.accountGuard || {};
  checkForbiddenIdentity(`${item.platform || 'unknown'} content row ${item.date || 'unknown'}`, [
    item.sourceUsername,
    item.sourceAccount?.username,
    item.sourceAccount?.accountName,
    item.sourceAccount?.accountId,
  ]);
  if (guard.contentUrlMustContain && !String(item.url || '').includes(guard.contentUrlMustContain)) {
    problems.push(`${item.platform}: content URL does not match expected account guard for ${item.date || 'unknown date'}`);
  }
  if (item.platform === 'tiktok' && normalize(item.sourceUsername) !== normalize(guard.expectedUsername)) {
    problems.push(`tiktok: content row ${item.sourceId || item.url || item.date || 'unknown'} sourceUsername is ${item.sourceUsername || 'missing'}, expected ${guard.expectedUsername}`);
  }
}

for (const override of data.rangeOverrides || []) {
  checkForbiddenIdentity(`${override.platform || 'unknown'} exact range override ${override.start || 'unknown'} to ${override.end || 'unknown'}`, [
    override.sourceUsername,
    override.sourceAccount?.username,
    override.sourceAccount?.accountName,
    override.sourceAccount?.accountId,
    override.account?.username,
    override.account?.accountName,
  ]);
  if (override.platform !== 'tiktok') continue;
  const guard = config.platforms?.tiktok?.accountGuard || {};
  const username = rangeSourceUsername(override);
  if (normalize(username) !== normalize(guard.expectedUsername)) {
    problems.push(`tiktok: exact range override ${override.start} to ${override.end} sourceUsername is ${username || 'missing'}, expected ${guard.expectedUsername}`);
  }
}

if (data.asOf) {
  const range = defaultRange(data.asOf);
  const comparisonRange = priorRange(range);
  const lastWeekRange = lastCompletedWeekRange(data.asOf);
  const checkedRanges = uniqueRanges([range, comparisonRange, lastWeekRange]);
  if (!isFridayThroughThursday(lastWeekRange)) {
    problems.push(`last-week preset is not a Friday-Thursday week: ${lastWeekRange.start} to ${lastWeekRange.end}`);
  }
  if (sameRange(range, comparisonRange)) {
    problems.push(`this-week and prior comparison resolve to the same range: ${range.start} to ${range.end}`);
  }
  const exactRangeRequirements = {
    instagram: ['views', 'reach'],
    facebook: ['views', 'reach'],
    youtube: ['views', 'watchTime'],
    tiktok: ['views', 'reach'],
  };
  for (const [platform, fields] of Object.entries(exactRangeRequirements)) {
    for (const checkedRange of checkedRanges) {
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

  for (const checkedRange of checkedRanges) {
    const override = findRangeOverride('youtube', checkedRange);
    if (!override) continue;
    const ytRows = rowsInRange(data.metrics?.youtube?.daily, checkedRange);
    const noteText = rangeNoteText('youtube', checkedRange, override);
    const allowPendingMismatch = !isFridayThroughThursday(checkedRange) && hasPendingRangeLanguage(noteText);
    for (const field of ['views', 'watchTime']) {
      const dailyValue = sumRows(ytRows, field);
      const exactValue = Number(override.values?.[field] || 0);
      if (dailyValue !== exactValue && !allowPendingMismatch) {
        problems.push(`youtube: ${checkedRange.start} to ${checkedRange.end} daily ${field} sum is ${dailyValue}, but exact range ${field} is ${exactValue}; refresh/backfill before publishing`);
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
if (!summary.refreshedAt) problems.push('refresh summary is missing refreshedAt');
if (!Array.isArray(summary.skippedItems)) problems.push('refresh summary is missing skippedItems array');
for (const platform of requiredPlatforms) {
  const platformSummary = summary.platforms?.[platform];
  if (!platformSummary) {
    problems.push(`refresh summary is missing ${platform} status`);
    continue;
  }
  if (!['live', 'partial', 'pending'].includes(platformSummary.status)) {
    problems.push(`refresh summary ${platform} has invalid status: ${platformSummary.status || 'missing'}`);
  }
  if (!platformSummary.historyStart) {
    problems.push(`refresh summary ${platform} is missing actual historyStart`);
  }
}

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
