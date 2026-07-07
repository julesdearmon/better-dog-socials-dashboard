#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('public/data.json', 'utf8'));
const config = JSON.parse(readFileSync('config/data-sources.json', 'utf8'));
const summary = JSON.parse(readFileSync('logs/latest-refresh-summary.json', 'utf8'));
const requiredPlatforms = Object.keys(config.platforms || {});
const generatedFrom = String(data.generatedFrom || '');
const problems = [];

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

if ((data.directApiErrors || []).length) problems.push(`directApiErrors is not empty: ${data.directApiErrors.length}`);
if (summary.sourceOfTruth !== config.sourceOfTruth) problems.push('refresh summary sourceOfTruth does not match config');
if (summary.dataThrough !== data.asOf) problems.push('refresh summary dataThrough does not match public/data.json asOf');
if (summary.generatedFrom !== data.generatedFrom) problems.push('refresh summary generatedFrom does not match public/data.json');
if ((summary.errors || []).length) problems.push(`refresh summary contains errors: ${summary.errors.length}`);

const updatedMs = Date.parse(String(data.updatedAt).replace(/, ([0-9]{1,2}:[0-9]{2} [AP]M)$/i, ', 2026 $1'));
const today = new Date();
const todayKey = today.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
if (!Number.isNaN(updatedMs)) {
  const updatedKey = new Date(updatedMs).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  if (updatedKey !== todayKey) problems.push(`updatedAt is not today: ${data.updatedAt}`);
}

if (problems.length) {
  console.error('Dashboard data validation failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(`Dashboard data is valid: ${generatedFrom}`);
