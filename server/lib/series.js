'use strict';

/**
 * Daily-series helpers for the live connectors.
 *
 * All connectors return the same shape — a trailing daily series ending on the
 * most recent complete day (yesterday). The frontend aggregates it into
 * Daily / Weekly (Fri–Thu) / Monthly periods.
 */

const DAY = 86400000;

/**
 * Build a zeroed daily series for the last `days` days ending yesterday,
 * plus a date->index map for fast accumulation.
 */
function emptyDaily(asOfMs, days) {
  const lastComplete = asOfMs - DAY;
  const arr = [];
  const idx = {};
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(lastComplete - i * DAY).toISOString().slice(0, 10);
    idx[date] = arr.length;
    arr.push({ date, posts: 0, views: 0, reach: 0, watchTime: null });
  }
  return { arr, idx };
}

/** Add a day's metrics (by ISO date) into the series, if that day is in range. */
function addDay(series, dateStr, { posts = 0, views = 0, reach = 0, watchTime = 0 } = {}) {
  const i = series.idx[dateStr];
  if (i == null) return;
  const row = series.arr[i];
  row.posts += posts;
  row.views += views;
  row.reach += reach;
  if (watchTime) row.watchTime = (row.watchTime || 0) + watchTime;
}

/** Window bounds (epoch seconds) for the last `days` days ending yesterday. */
function windowSeconds(asOfMs, days) {
  const until = Math.floor((asOfMs - DAY) / 1000);
  const since = Math.floor((asOfMs - days * DAY) / 1000);
  return { since, until };
}

module.exports = { emptyDaily, addDay, windowSeconds, DAY };
