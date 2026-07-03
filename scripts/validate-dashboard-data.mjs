#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync('public/data.json', 'utf8'));
const requiredPlatforms = ['instagram', 'facebook', 'tiktok', 'youtube'];
const generatedFrom = String(data.generatedFrom || '');
const problems = [];

for (const platform of requiredPlatforms) {
  const metric = data.metrics?.[platform];
  if (!metric) problems.push(`${platform}: missing metrics`);
  if (!generatedFrom.toLowerCase().includes(platform)) problems.push(`${platform}: missing from generatedFrom`);
  if (metric?.provider !== 'supermetrics') problems.push(`${platform}: provider is not Supermetrics`);
  if (metric?.carriedForward) problems.push(`${platform}: carried-forward data is still enabled`);
  if (!Array.isArray(metric?.daily) || metric.daily.length === 0) problems.push(`${platform}: no daily rows`);
}

if ((data.directApiErrors || []).length) problems.push(`directApiErrors is not empty: ${data.directApiErrors.length}`);

if (problems.length) {
  console.error('Dashboard data validation failed:');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(`Dashboard data is valid: ${generatedFrom}`);
