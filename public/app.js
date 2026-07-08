'use strict';

const PLATFORM_COLORS = {
  instagram: '#f97316', // orange
  facebook: '#1877f2',  // blue
  tiktok: '#8b5cf6',    // purple
  youtube: '#ff0000'    // red
};
const TOTAL_COLOR = '#222322'; // Better Dog brand near-black
const DISPLAY_NAMES = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube' };
const PLATFORM_ORDER = ['instagram', 'facebook', 'youtube', 'tiktok'];
const nameOf = (p) => DISPLAY_NAMES[p] || capWord(p);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const GRAN_NOUN = { daily: 'day', weekly: 'week', monthly: 'month' };
const GRAN_LABEL = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
const THEME_KEY = 'betterDogDashboardThemeChoice';

const state = {
  clients: [], clientId: null,
  granularity: 'weekly',            // how the chart lines are grouped within the range
  rangeStart: null, rangeEnd: null, // selected date range (YYYY-MM-DD), inclusive
  priorRange: null,                 // equal-length window immediately before the range
  calMonth: null, calPick: null, calHover: null, // calendar popover state
  insightKey: null,        // which chart point's insight is currently open (for click-to-toggle)
  selectedPlatforms: [],   // one or more toggled platform chips
  totalOnly: true,         // true = charts show only the combined Total line
  contentSort: 'views',
  data: null, periods: [], priorPeriods: [], series: {}, priorSeries: {}, curTotals: {}, priorTotals: {}
};
const charts = {};
let offline = false;

const $ = (s) => document.querySelector(s);
const DAY = 86400000;

function savedTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch (err) {
    // Ignore blocked storage.
  }
  return 'light';
}

function setTheme(theme, options = {}) {
  const { rerender = false, persist = false } = options;
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  if (persist) {
    try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* ignore blocked storage */ }
  }
  const btn = $('#themeToggle');
  if (btn) {
    const dark = next === 'dark';
    btn.classList.toggle('is-dark', dark);
    btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
  }
  if (rerender && state.data) render();
}

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function chartTheme() {
  return {
    grid: cssVar('--chart-grid', '#e7ecd6'),
    legend: cssVar('--chart-legend', '#4b5043'),
    ticks: cssVar('--muted', '#717869'),
    tooltipBg: cssVar('--text', '#222322'),
    tooltipText: cssVar('--panel', '#ffffff'),
    total: cssVar('--total-line', TOTAL_COLOR),
  };
}

function rangeDays() {
  if (!state.rangeStart || !state.rangeEnd) return 0;
  return Math.round((Date.parse(state.rangeEnd + 'T00:00:00Z') - Date.parse(state.rangeStart + 'T00:00:00Z')) / DAY) + 1;
}
function chartGranularity() {
  const allowed = allowedGranularities();
  return allowed.includes(state.granularity) ? state.granularity : allowed[0];
}
function allowedGranularities() {
  const days = rangeDays();
  if (!days || days <= 14) return ['daily'];
  if (days <= 45) return ['daily', 'weekly'];
  return ['daily', 'weekly', 'monthly'];
}
function suggestedGranularity(startIso, endIso) {
  const days = Math.round((Date.parse(endIso + 'T00:00:00Z') - Date.parse(startIso + 'T00:00:00Z')) / DAY) + 1;
  if (days <= 31) return 'daily';
  if (days <= 120) return 'weekly';
  return 'monthly';
}
function setGranButton(g) {
  const allowed = allowedGranularities();
  const toggle = $('#granToggle');
  toggle.classList.toggle('single-option', allowed.length === 1);
  [...toggle.children].forEach((b) => {
    const isAllowed = allowed.includes(b.dataset.g);
    b.hidden = !isAllowed;
    b.disabled = !isAllowed;
    b.classList.toggle('active', isAllowed && b.dataset.g === g);
  });
}

function fmt(n) {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(Math.round(n));
}
const fmtFull = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const capWord = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function showLoading(on) { $('#loading').classList.toggle('show', on); }

async function getJson(url) {
  if (offline) throw new Error('offline');
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// ---------------------------------------------------------------------------
// Date range → period buckets. Periods are COMPLETE buckets of the chosen
// granularity that fall fully within [rangeStart, rangeEnd]; the charts plot
// these. Headline metrics use the exact picked dates (see sumRange).
// ---------------------------------------------------------------------------
function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
function midnightUTC(ms) { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
function shiftIsoDate(isoDate, days) { return iso(Date.parse(isoDate + 'T00:00:00Z') + days * DAY); }
function weekLabel(s, e) {
  return s.getUTCMonth() === e.getUTCMonth()
    ? `${MONTHS[s.getUTCMonth()]} ${s.getUTCDate()}–${e.getUTCDate()}`
    : `${MONTHS[s.getUTCMonth()]} ${s.getUTCDate()}–${MONTHS[e.getUTCMonth()]} ${e.getUTCDate()}`;
}

function periodsInRange(granularity, startMs, endMs) {
  const out = [];
  if (endMs < startMs) return out;
  if (granularity === 'daily') {
    for (let d = startMs; d <= endMs; d += DAY) {
      const dt = new Date(d);
      out.push({ start: iso(d), end: iso(d), label: `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}` });
    }
    return out;
  }
  if (granularity === 'monthly') {
    let y = new Date(startMs).getUTCFullYear(), m = new Date(startMs).getUTCMonth();
    for (;;) {
      const mStart = Date.UTC(y, m, 1), mEnd = Date.UTC(y, m + 1, 0);
      if (mStart > endMs) break;
      if (mStart >= startMs && mEnd <= endMs) out.push({ start: iso(mStart), end: iso(mEnd), label: `${MONTHS[m]} ${y}` });
      m++; if (m > 11) { m = 0; y++; }
    }
    return out;
  }
  // weekly: Friday→Thursday weeks fully inside the range.
  let fri = startMs + ((5 - new Date(startMs).getUTCDay() + 7) % 7) * DAY;
  for (; fri + 6 * DAY <= endMs; fri += 7 * DAY) {
    const end = fri + 6 * DAY;
    out.push({ start: iso(fri), end: iso(end), label: weekLabel(new Date(fri), new Date(end)) });
  }
  return out;
}

function latestTotalFollowers(metric) {
  if (!metric) return null;
  if (metric.totalFollowers != null) return metric.totalFollowers;
  let latest = null;
  for (const row of metric.daily || []) {
    if (row.totalFollowers != null) latest = row.totalFollowers;
  }
  return latest;
}

// Sum a platform's daily rows over an inclusive [startIso, endIso] window.
function sumRange(metric, startIso, endIso) {
  const daily = Array.isArray(metric) ? metric : (metric?.daily || []);
  const hasFollowers = !Array.isArray(metric) && !!metric?.hasFollowers;
  const t = { posts: 0, views: 0, reach: 0, watchTime: null, newFollowers: null, totalFollowers: latestTotalFollowers(metric) };
  let followerSum = 0;
  let followerSeen = false;
  for (const row of daily) {
    if (row.date < startIso || row.date > endIso) continue;
    t.posts += row.posts || 0;
    t.views += row.views || 0;
    t.reach += row.reach || 0;
    if (row.watchTime != null) t.watchTime = (t.watchTime || 0) + row.watchTime;
    if (hasFollowers && row.newFollowers != null) {
      followerSeen = true;
      followerSum += row.newFollowers || 0;
    }
  }
  if (hasFollowers) t.newFollowers = followerSeen ? followerSum : null;
  return t;
}

function businessSuiteOverride(platform, startIso, endIso) {
  const ranges = [
    ...(state.data?.rangeOverrides || []),
    ...(window.BUSINESS_SUITE_OVERRIDES?.ranges || [])
  ];
  return ranges.find((r) => r.platform === platform && r.start === startIso && r.end === endIso) || null;
}

function applyBusinessSuiteOverride(platform, totals, startIso, endIso) {
  const override = businessSuiteOverride(platform, startIso, endIso);
  if (!override) return totals;
  const next = { ...totals };
  for (const [key, value] of Object.entries(override.values || {})) next[key] = value;
  next.businessSuiteOverride = override.source || 'Meta Business Suite';
  return next;
}

function applyBusinessSuiteSeriesOverrides(seriesMap = state.series, startIso = state.rangeStart, endIso = state.rangeEnd) {
  for (const p of Object.keys(seriesMap || {})) {
    const override = businessSuiteOverride(p, startIso, endIso);
    if (!override || override.seriesDistribute === false) continue;
    for (const [metric, target] of Object.entries(override.values || {})) {
      const rows = seriesMap[p] || [];
      if (!rows.length || !Number.isFinite(Number(target))) continue;
      const current = rows.reduce((sum, row) => sum + (row[metric] || 0), 0);
      if (current > 0) {
        let assigned = 0;
        rows.forEach((row, index) => {
          const value = index === rows.length - 1 ? Number(target) - assigned : Math.round((row[metric] || 0) / current * Number(target));
          row[metric] = value;
          assigned += value;
        });
      } else {
        const base = Math.floor(Number(target) / rows.length);
        let remainder = Number(target) - base * rows.length;
        rows.forEach((row) => {
          row[metric] = base + (remainder > 0 ? 1 : 0);
          remainder -= 1;
        });
      }
    }
  }
}

// Quick-preset ranges. Each also picks a sensible chart grouping.
function presetRange(name, asOfMs) {
  const base = midnightUTC(asOfMs);
  const d = new Date(base);
  let diff = (d.getUTCDay() - 4 + 7) % 7; if (diff === 0) diff = 7;
  const thu = base - diff * DAY;                              // most recent completed Thursday
  const thisWeekStart = base - ((d.getUTCDay() - 5 + 7) % 7) * DAY; // current Friday-Thursday reporting week
  const monthFirst = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const lastMonthEnd = monthFirst - DAY;                      // last day of the previous month
  const lastMonth = new Date(lastMonthEnd);
  const lastMonthStart = Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth(), 1);
  const last3MonthsStart = Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth() - 2, 1);
  if (name === 'ytd-2026') return { start: '2026-01-01', end: iso(base), gran: 'monthly' };
  if (name === 'this-week') return { start: iso(thisWeekStart), end: iso(base), gran: 'daily' };
  if (name === 'last-week') return { start: iso(thu - 6 * DAY), end: iso(thu), gran: 'daily' };
  if (name === 'this-month') return { start: iso(monthFirst), end: iso(base), gran: 'daily' };
  if (name === 'last-month') return { start: iso(lastMonthStart), end: iso(lastMonthEnd), gran: 'weekly' };
  if (name === 'last-3-months') return { start: iso(last3MonthsStart), end: iso(lastMonthEnd), gran: 'weekly' };
  return null;
}

// Default range: current reporting week through the latest available data.
function defaultRange(asOfMs) {
  return presetRange('this-week', asOfMs);
}

// Human label for the selected range, e.g. "Jun 1 – Jun 30, 2026".
function rangeLabel(startIso, endIso) {
  const s = new Date(startIso + 'T00:00:00Z'), e = new Date(endIso + 'T00:00:00Z');
  const f = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return `${f(s)} – ${f(e)}, ${e.getUTCFullYear()}`;
}

const sourceDate = (m) => m?.asOf ? niceDate(m.asOf) : 'prior refresh';
function isCarriedForward(p) {
  return !!state.data?.metrics?.[p]?.carriedForward;
}
function isPendingPlatform(p) {
  return isCarriedForward(p);
}
function sourceStatus(p) {
  const m = state.data?.metrics?.[p] || {};
  if (m.carriedForward) return { label: 'Pending approval - no live data shown', cls: 'stale' };
  if (m.provider) return { label: `Fresh API data (${m.provider})`, cls: 'fresh' };
  return { label: m.source === 'live' ? 'Live data' : 'Demo or imported data', cls: m.source === 'live' ? 'fresh' : 'stale' };
}
function freshnessSummary() {
  const fresh = [];
  const pending = [];
  for (const p of allPlatforms()) {
    if (isCarriedForward(p)) pending.push(`${nameOf(p)} from ${sourceDate(state.data.metrics[p])}`);
    else fresh.push(nameOf(p));
  }
  return { fresh, pending, stale: pending };
}

function reachContextSummary() {
  const ps = platforms().filter((p) => supports(p, 'reach'));
  if (!ps.length) return '';
  const parts = [];
  if (platforms().includes('youtube')) parts.push('Reach excludes YouTube.');
  if (ps.includes('instagram')) parts.push('Instagram reach includes paid/promoted distribution.');
  if (ps.includes('facebook')) parts.push('Facebook reach uses total unique media views and may include paid distribution.');
  return parts.join(' ');
}

function viewsContextSummary() {
  const ps = platforms().filter((p) => supports(p, 'views'));
  const parts = [];
  if (ps.includes('instagram')) parts.push('Instagram views include paid/promoted distribution.');
  if (ps.includes('facebook')) parts.push('Facebook views are organic media views.');
  if (ps.includes('youtube')) parts.push('YouTube ADVERTISING traffic is tracked separately in analysis.');
  return parts.join(' ');
}

function renderMetricNotes() {
  const setPriorLegend = (selector, metricKey, cardSelector) => {
    const el = $(selector);
    if (!el) return;
    const show = hasPriorChartData(metricKey) && !$(cardSelector)?.hidden;
    el.innerHTML = show ? '<span class="legend-dash" aria-hidden="true"></span><span>Prior period</span>' : '';
    el.hidden = !show;
  };
  const join = (...parts) => parts.filter(Boolean).join(' ');
  setPriorLegend('#viewsLegend', 'views', '#viewsCard');
  setPriorLegend('#postsLegend', 'posts', '#postsCard');
  setPriorLegend('#reachLegend', 'reach', '#reachCard');
  setPriorLegend('#watchLegend', 'watchTime', '#watchCard');
  const viewsNote = $('#viewsNote');
  if (viewsNote) {
    const note = viewsContextSummary();
    viewsNote.textContent = note;
    viewsNote.hidden = !note || $('#viewsCard')?.hidden;
  }
  const postsNote = $('#postsNote');
  if (postsNote) {
    postsNote.textContent = '';
    postsNote.hidden = true;
  }
  const reachNote = $('#reachNote');
  if (!reachNote) return;
  const note = reachContextSummary();
  reachNote.textContent = note;
  reachNote.hidden = !note || $('#reachCard')?.hidden;
  const watchNote = $('#watchNote');
  if (watchNote) {
    const watchText = join(platforms().includes('youtube') ? 'YouTube ad-driven watch time is checked separately in analysis.' : '');
    watchNote.textContent = watchText;
    watchNote.hidden = !watchText || $('#watchCard')?.hidden;
  }
}

// ---------------------------------------------------------------------------
// Click-to-highlight calendar: click a start day, then an end day.
// ---------------------------------------------------------------------------
function calBounds() {
  const dl = state.data.metrics.instagram.daily;
  return { min: dl[0].date, max: dl[dl.length - 1].date };
}
function renderCalBtn() {
  const btn = $('#calBtn');
  btn.textContent = 'Custom dates';
  btn.title = `Selected range: ${rangeLabel(state.rangeStart, state.rangeEnd)}`;
  btn.setAttribute('aria-label', `Choose custom dates. Selected range: ${rangeLabel(state.rangeStart, state.rangeEnd)}`);
}
// Build the month grid once (on open / month change). Day buttons are NOT
// rebuilt on hover — only their highlight classes update — so a click is never
// interrupted by the element being replaced mid-press.
function buildCalGrid() {
  const d0 = new Date(state.calMonth);
  const y = d0.getUTCFullYear(), m = d0.getUTCMonth();
  $('#calTitle').textContent = `${MONTHS[m]} ${y}`;
  const firstDow = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const b = calBounds();
  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += '<span class="cal-cell empty"></span>';
  for (let day = 1; day <= days; day++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dis = (iso < b.min || iso > b.max);
    cells += `<button type="button" class="cal-cell${dis ? ' disabled' : ''}" data-iso="${iso}"${dis ? ' disabled' : ''}>${day}</button>`;
  }
  $('#calGrid').innerHTML = cells;
}
function applyCalHighlights() {
  // While selecting, preview the range from the first pick to the hovered day.
  let rs = state.rangeStart, re = state.rangeEnd;
  if (state.calPick) { const a = state.calPick, h = state.calHover || state.calPick; rs = a < h ? a : h; re = a < h ? h : a; }
  for (const cell of $('#calGrid').querySelectorAll('button[data-iso]')) {
    const iso = cell.dataset.iso;
    const inB = !cell.hasAttribute('disabled');
    cell.classList.toggle('range-start', inB && iso === rs);
    cell.classList.toggle('range-end', inB && iso === re);
    cell.classList.toggle('sel', inB && (iso === rs || iso === re));
    cell.classList.toggle('in-range', inB && iso > rs && iso < re);
  }
  $('#calFoot').textContent = state.calPick ? 'Now click the end day.' : 'Click a start day, then an end day.';
}
function renderCal() { buildCalGrid(); applyCalHighlights(); }
function openCal() {
  state.calPick = null; state.calHover = null;
  const e = new Date(state.rangeEnd + 'T00:00:00Z');
  state.calMonth = Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), 1);
  $('#calPop').hidden = false;
  renderCal();
}
function closeCal() { $('#calPop').hidden = true; state.calPick = null; state.calHover = null; }
function setupCalendar() {
  $('#calBtn').addEventListener('click', (e) => { e.stopPropagation(); $('#calPop').hidden ? openCal() : closeCal(); });
  document.addEventListener('click', () => { if (!$('#calPop').hidden) closeCal(); });
  $('#calPop').addEventListener('click', (e) => {
    e.stopPropagation();
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const d = new Date(state.calMonth);
      state.calMonth = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Number(nav.dataset.nav), 1);
      renderCal();
      return;
    }
    const cell = e.target.closest('button[data-iso]');
    if (!cell || cell.hasAttribute('disabled')) return;
    const iso = cell.dataset.iso;
    if (!state.calPick) { state.calPick = iso; state.calHover = iso; applyCalHighlights(); }
    else {
      const a = state.calPick;
      state.rangeStart = a < iso ? a : iso;
      state.rangeEnd = a < iso ? iso : a;
      state.granularity = suggestedGranularity(state.rangeStart, state.rangeEnd);
      setGranButton(state.granularity);
      state.calPick = null;
      closeCal();
      render();
    }
  });
  $('#calGrid').addEventListener('mouseover', (e) => {
    const cell = e.target.closest('button[data-iso]');
    if (!cell || !state.calPick) return;
    state.calHover = cell.dataset.iso;
    applyCalHighlights();
  });
}

// Sum a platform's daily rows into the period buckets.
function bucket(daily, periods) {
  if (!periods.length) return [];
  const out = periods.map((p) => ({ ...p, _rowCount: 0, posts: 0, views: 0, reach: 0, watchTime: null, paidViews: 0, adViews: 0, adWatchTime: 0, newFollowers: null, totalFollowers: null }));
  // periods are contiguous & sorted; walk with a moving cursor for efficiency.
  let pi = 0;
  for (const row of daily) {
    if (row.date < periods[0].start) continue;
    while (pi < periods.length && row.date > periods[pi].end) pi++;
    if (pi >= periods.length) break;
    if (row.date < periods[pi].start) continue; // gap between periods
    const b = out[pi];
    b._rowCount += 1;
    b.posts += row.posts || 0;
    b.views += row.views || 0;
    b.reach += row.reach || 0;
    if (row.watchTime != null) b.watchTime = (b.watchTime || 0) + row.watchTime;
    if (row.paidViews != null) b.paidViews += row.paidViews || 0;
    if (row.adViews != null) b.adViews += row.adViews || 0;
    if (row.adWatchTime != null) b.adWatchTime += row.adWatchTime || 0;
    if (row.newFollowers != null) b.newFollowers = (b.newFollowers || 0) + row.newFollowers;
    if (row.totalFollowers != null) b.totalFollowers = row.totalFollowers;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Metric accessors (operate on state.series, aligned to state.periods)
// ---------------------------------------------------------------------------
const METRICS = [
  { key: 'views', label: 'Views', fmt: fmt },
  { key: 'reach', label: 'Reach', fmt: fmt },
  { key: 'watchTime', label: 'Watch time', fmt: (m) => (m == null ? '—' : fmt(m / 60) + ' hrs') },
  { key: 'posts', label: 'Posts', fmt: fmtFull },
  { key: 'newFollowers', label: 'New followers', fmt: fmtFull },
  { key: 'totalFollowers', label: 'Total followers', fmt: fmtFull, showDelta: false }
];

const CORE_METRIC_KEYS = ['views', 'posts'];

// Every platform that has data.
function allPlatforms() {
  return Object.keys(state.data.metrics).filter((p) => {
    const m = state.data.metrics[p];
    return m && m.daily && m.daily.length;
  }).sort((a, b) => {
    const ai = PLATFORM_ORDER.indexOf(a);
    const bi = PLATFORM_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}
// Platforms currently shown (respects the platform filter; never empty).
function platforms() {
  const all = allPlatforms();
  const active = all.filter((p) => !isPendingPlatform(p));
  if (state.totalOnly) return active.length ? active : all;
  const selected = Array.isArray(state.selectedPlatforms) ? state.selectedPlatforms : [];
  const sel = all.filter((p) => selected.includes(p));
  return sel.length ? sel : (active.length ? active : all);
}
function focusedPlatform() {
  if (state.totalOnly) return null;
  if (state.selectedPlatforms && state.selectedPlatforms.length === 1) return state.selectedPlatforms[0];
  return null;
}
function visibleMetricKeys() {
  const keys = [...CORE_METRIC_KEYS];
  const focus = focusedPlatform();
  const shown = platforms();
  const hasFollowers = shown.some((p) => supports(p, 'newFollowers') || supports(p, 'totalFollowers'));
  if (hasFollowers) keys.push('newFollowers', 'totalFollowers');
  if (shown.some((p) => supports(p, 'reach'))) keys.push('reach');
  if (focus === 'youtube') keys.push('watchTime');
  return keys;
}
function visibleMetrics() {
  const keys = visibleMetricKeys();
  return keys.map((key) => METRICS.find((m) => m.key === key)).filter(Boolean);
}
function hasNewFollowerRows(p, startIso = state.rangeStart, endIso = state.rangeEnd) {
  return (state.data?.metrics?.[p]?.daily || []).some((row) => (
    row.date >= startIso && row.date <= endIso && row.newFollowers != null
  ));
}
// Whether a platform reports a given metric (e.g. YouTube has no reach metric,
// only YouTube has watch time).
function supports(p, key) {
  if (isPendingPlatform(p)) return false;
  const m = state.data.metrics[p];
  const hasOverride = businessSuiteOverride(p, state.rangeStart, state.rangeEnd)?.values?.[key] != null;
  if (hasOverride) return true;
  if (key === 'views') return m.hasViews !== false;
  if (key === 'watchTime') return !!m.hasWatchTime;
  if (key === 'reach') return m.hasReach !== false;
  if (key === 'newFollowers') return !!m.hasFollowers && (m.hasNewFollowers !== false || hasNewFollowerRows(p));
  if (key === 'totalFollowers') return !!m.hasFollowers;
  return true;
}
// Totals over the selected range (fromEnd 0) or the prior equal-length window (1).
function totalAt(metricKey, fromEnd) {
  const totals = fromEnd === 0 ? state.curTotals : state.priorTotals;
  let sum = 0;
  let sawValue = false;
  let missing = false;
  for (const p of platforms()) {
    if (!supports(p, metricKey)) continue;
    const t = totals[p];
    if (t && t[metricKey] != null) {
      sum += t[metricKey];
      sawValue = true;
    } else if (metricKey === 'newFollowers') {
      missing = true;
    }
  }
  if (missing) return null;
  return sawValue ? sum : null;
}
function platformAt(p, metricKey, fromEnd) {
  const t = (fromEnd === 0 ? state.curTotals : state.priorTotals)[p];
  return t ? t[metricKey] : null;
}
function deltaPct(curr, prev) { return curr != null && prev ? (curr - prev) / prev : null; }
function deltaHtml(curr, prev) {
  const d = deltaPct(curr, prev);
  if (d == null) return `<span class="delta flat">— no prior period</span>`;
  const up = d >= 0;
  return `<span class="delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${(Math.abs(d) * 100).toFixed(1)}% vs prior period</span>`;
}
function scrollToAnalysis() {
  const card = $('#overviewCard');
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  card.classList.add('analysis-highlight');
  window.setTimeout(() => card.classList.remove('analysis-highlight'), 1400);
}
function deltaHtmlWithHelp(curr, prev, metricKey) {
  const base = deltaHtml(curr, prev);
  if (deltaPct(curr, prev) == null) return base;
  const help = `<button type="button" class="kpi-help" data-analysis-jump="${escapeHtml(metricKey)}" title="Click to get more information" aria-label="Click to see why this changed">?</button>`;
  return `<span class="delta-wrap">${base}${help}</span>`;
}
function miniDelta(curr, prev) {
  const d = deltaPct(curr, prev);
  if (d == null) return '<span class="mini flat">—</span>';
  const up = d >= 0;
  return `<span class="mini ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${(Math.abs(d) * 100).toFixed(0)}%</span>`;
}

// ---------------------------------------------------------------------------
// Init + load
// ---------------------------------------------------------------------------
async function init() {
  let clients, status;
  try {
    [{ clients }, status] = await Promise.all([getJson('/api/clients'), getJson('/api/status')]);
  } catch (err) {
    offline = true;
    clients = window.DEMO.clients().clients;
    status = { demoMode: true };
  }

  state.clients = clients;
  state.clientId = clients[0]?.id;

  const sel = $('#clientSelect');
  if (sel) {
    sel.innerHTML = clients.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
    sel.addEventListener('change', (e) => { state.clientId = e.target.value; load(); });
  }

  // Granularity toggle
  $('#granToggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-g]');
    if (!btn) return;
    setGranularity(btn.dataset.g);
  });
  setupCalendar();
  // Quick range presets.
  $('#rangePresets').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-preset]');
    if (!btn) return;
    const r = presetRange(btn.dataset.preset, Date.parse(state.data.asOf + 'T00:00:00Z'));
    if (!r) return;
    state.rangeStart = r.start; state.rangeEnd = r.end; state.granularity = r.gran;
    setGranButton(state.granularity);
    render();
  });
  $('#exportBtn').addEventListener('click', exportCsv);
  $('#themeToggle')?.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    setTheme(current === 'dark' ? 'light' : 'dark', { rerender: true, persist: true });
  });
  $('#kpis')?.addEventListener('click', (e) => {
    if (!e.target.closest('.kpi-help')) return;
    scrollToAnalysis();
  });
  $('#insightClose').addEventListener('click', () => { $('#insightPanel').hidden = true; state.insightKey = null; });

  // Top-content controls
  $('#contentSort').addEventListener('change', (e) => { state.contentSort = e.target.value; renderContent(); });

  // Platform focus selector (delegated; chips rendered after data loads).
  // Clicking a chip focuses one view: all platforms plus total, a single platform, or total-only.
  $('#platformFilter').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-focus]');
    if (!btn) return;
    setFocus(btn.dataset.focus);
  });

  await load();
}

// Show DEMO vs LIVE based on the loaded data's source.
function updateMode() {
  const live = state.data && state.data.source === 'live';
  const badge = $('#modeBadge');
  badge.textContent = live ? 'LIVE DATA' : 'DEMO DATA';
  badge.classList.toggle('live', live);
  badge.classList.toggle('demo', !live);
  $('#demoBanner').hidden = live;
  const note = $('#liveNote');
  if (live) {
    const dl = state.data.metrics.instagram ? state.data.metrics.instagram.daily : [];
    const through = dl.length ? niceDate(dl[dl.length - 1].date) : niceDate(state.data.asOf);
    const updated = state.data.updatedAt || 'unknown';
    const errors = state.data.directApiErrors || [];
    const tiktokPending = errors.some((x) => /^tiktok:/i.test(x)) || isPendingPlatform('tiktok');
    const tiktokTopContentUnavailable = state.data.metrics?.tiktok?.hasTopContent === false;
    const realErrors = errors.filter((x) => !/^tiktok:/i.test(x));
    const parts = [`Updated ${updated}`, `Data through ${through}`, 'Source: Supermetrics'];
    if (tiktokPending) parts.push('TikTok not connected yet');
    else if (tiktokTopContentUnavailable) parts.push('TikTok top content unavailable');
    if (realErrors.length) parts.push(`Warning: Connection issue: ${realErrors.join(' | ')}`);
    note.textContent = parts.join(' - ');
    note.hidden = false;
  } else {
    note.hidden = true;
  }
}
function niceDate(iso) {
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
  return isNaN(d) ? iso : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function renderDataQuality() {
  const quality = $('#dataQualityNote');
  const notes = [];
  const realErrors = (state.data.directApiErrors || []).filter((x) => !/^tiktok:/i.test(x));
  if (realErrors.length) notes.push(`⚠️ Connection issue: ${escapeHtml(realErrors.join(' | '))}`);
  for (const p of allPlatforms()) {
    const m = state.data.metrics[p] || {};
    const override = businessSuiteOverride(p, state.rangeStart, state.rangeEnd);
    if (!override && m.hasViews === false && m.viewsUnavailableReason) notes.push(`${escapeHtml(nameOf(p))}: ${escapeHtml(m.viewsUnavailableReason)}`);
    if (!override && m.provider === 'meta-media-insights-api') notes.push(`${escapeHtml(nameOf(p))}: Meta account-level date-range views were not available, so this uses media-level post insights for content published in the selected range.`);
    if (m.historyStart && state.rangeStart < m.historyStart) {
      notes.push(`${escapeHtml(nameOf(p))}: metrics available from ${escapeHtml(niceDate(m.historyStart))} in the current connector.`);
    }
  }
  if (!notes.length) {
    quality.hidden = true;
    return;
  }
  if ((window.BUSINESS_SUITE_OVERRIDES?.ranges || []).some((r) => r.start === state.rangeStart && r.end === state.rangeEnd)) {
    notes.push('Chart points are distributed from available daily API detail.');
  }
  quality.innerHTML = [...new Set(notes)].join(' ');
  quality.hidden = false;
}
function setGranularity(g) {
  if (!GRAN_NOUN[g] || !allowedGranularities().includes(g)) return;
  state.granularity = g;
  setGranButton(state.granularity);
  render();
}

async function load() {
  if (!state.clientId) return;
  showLoading(true);
  try {
    let gotReal = false;
    // 1a) Embedded real data (realdata.js) — works even when the dashboard is
    // opened directly as a file:// page (browsers block fetch of local JSON).
    if (window.REAL_DATA && window.REAL_DATA.metrics) {
      state.data = window.REAL_DATA;
      gotReal = true;
    }
    // 1b) Otherwise try the real data file over HTTP (when served by a server).
    if (!gotReal) try {
      const res = await fetch('data.json?t=' + Date.now());
      if (res.ok) { state.data = await res.json(); gotReal = true; }
    } catch (e0) { /* no data.json — fall through */ }

    if (!gotReal) {
      try {
        // 2) Live Node server (direct platform APIs).
        state.data = await getJson(`/api/metrics/${state.clientId}?days=400`);
      } catch (e2) {
        // 3) Fallback: in-browser demo data.
        offline = true;
        state.data = window.DEMO.metrics(state.clientId, 400);
      }
    }
    if (!state.rangeStart || !state.rangeEnd) {
      const r = defaultRange(Date.parse(state.data.asOf + 'T00:00:00Z'));
      const firstDate = state.data.metrics?.instagram?.daily?.[0]?.date;
      if (firstDate && firstDate > r.start) r.start = firstDate;
      state.rangeStart = r.start; state.rangeEnd = r.end;
    }
    render();
  } catch (err) {
    console.error(err);
    alert('Failed to load metrics: ' + err.message);
  } finally {
    showLoading(false);
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function buildSeries() {
  const startMs = Date.parse(state.rangeStart + 'T00:00:00Z');
  const endMs = Date.parse(state.rangeEnd + 'T00:00:00Z');
  const chartGran = chartGranularity();
  // Chart buckets within the range.
  state.periods = periodsInRange(chartGran, startMs, endMs);
  if (!state.periods.length && startMs <= endMs) state.periods = periodsInRange('daily', startMs, endMs);
  // Headline totals: exact picked dates, vs the equal-length window right before.
  const lenDays = Math.round((endMs - startMs) / DAY) + 1;
  const priorEndMs = startMs - DAY;
  const priorStartMs = priorEndMs - (lenDays - 1) * DAY;
  state.priorRange = { start: iso(priorStartMs), end: iso(priorEndMs) };
  state.priorPeriods = state.periods.map((p) => ({
    ...p,
    start: shiftIsoDate(p.start, -lenDays),
    end: shiftIsoDate(p.end, -lenDays)
  }));
  state.series = {};
  state.priorSeries = {};
  for (const p of platforms()) {
    state.series[p] = bucket(state.data.metrics[p].daily, state.periods);
    state.priorSeries[p] = bucket(state.data.metrics[p].daily, state.priorPeriods);
  }
  applyBusinessSuiteSeriesOverrides(state.series, state.rangeStart, state.rangeEnd);
  applyBusinessSuiteSeriesOverrides(state.priorSeries, state.priorRange.start, state.priorRange.end);
  state.curTotals = {}; state.priorTotals = {};
  for (const p of allPlatforms()) {
    state.curTotals[p] = applyBusinessSuiteOverride(p, sumRange(state.data.metrics[p], state.rangeStart, state.rangeEnd), state.rangeStart, state.rangeEnd);
    state.priorTotals[p] = applyBusinessSuiteOverride(p, sumRange(state.data.metrics[p], state.priorRange.start, state.priorRange.end), state.priorRange.start, state.priorRange.end);
  }
}

function render() {
  buildSeries();
  updateMode();
  renderDataQuality();
  $('#insightPanel').hidden = true; state.insightKey = null; // stale once the view changes; re-click to refresh
  const chartGran = chartGranularity();
  const noun = GRAN_NOUN[chartGran];
  state.granularity = chartGran;
  setGranButton(chartGran);

  // Reflect the selected range in the calendar button + header.
  renderCalBtn();
  // Highlight a preset only when the range exactly matches it.
  const asOfMs = Date.parse(state.data.asOf + 'T00:00:00Z');
  [...$('#rangePresets').children].forEach((b) => {
    const r = presetRange(b.dataset.preset, asOfMs);
    b.classList.toggle('active', !!r && r.start === state.rangeStart && r.end === state.rangeEnd);
  });
  const rLabel = rangeLabel(state.rangeStart, state.rangeEnd);
  const compareLabel = rangeLabel(state.priorRange.start, state.priorRange.end);
  $('#reportWeek').textContent = rLabel;
  $('#periodNote').innerHTML = `Compared with <strong>${compareLabel}</strong> · charted by <strong>${noun}</strong>.`;

  $('#postsTitle').textContent = `Posts per ${noun}`;
  $('#viewsTitle').textContent = `Views per ${noun}`;
  $('#reachTitle').textContent = `Reach per ${noun}`;
  $('#watchTitle').textContent = `YouTube watch time per ${noun}`;
  renderPlatformFilter();
  renderChartVisibility();
  renderMetricNotes();
  renderKpis();
  renderPlatformCards();
  renderCreativeOverview();
  renderTrend('postsChart', 'posts');
  renderTrend('viewsChart', 'views');
  if (!$('#reachCard')?.hidden) renderTrend('reachChart', 'reach');
  else if (charts.reachChart) { charts.reachChart.destroy(); delete charts.reachChart; }
  if (!$('#watchCard')?.hidden) renderWatchChart();
  else if (charts.watchChart) { charts.watchChart.destroy(); delete charts.watchChart; }
  renderContent();
}

// Overall, all-platform analysis of the selected range. Built ENTIRELY from the
// API data — no invented commentary. Wording adapts to week / month / custom range.
function wordDelta(d) {
  if (d == null) return '';
  const up = d >= 0;
  return ` <span class="ov-delta ${up ? 'up' : 'down'}">(${up ? 'up' : 'down'} ${(Math.abs(d) * 100).toFixed(0)}%)</span>`;
}
function shortTitle(c) {
  const t = c && c.title && c.title.trim() ? c.title : (c ? `${capWord(c.platform)} post` : '');
  return t.length > 80 ? t.slice(0, 80).replace(/\s+\S*$/, '') + '…' : t;
}
function linkedTop(c) {
  if (!c) return '';
  const label = escapeHtml(shortTitle(c));
  return (c.url && c.url !== '#') ? `<a class="content-link" href="${escapeHtml(c.url)}" target="_blank" rel="noopener">${label}</a>` : label;
}
// Describe the selected range as a week / month / custom period.
function periodInfo() {
  const s = new Date(state.rangeStart + 'T00:00:00Z'), e = new Date(state.rangeEnd + 'T00:00:00Z');
  const days = Math.round((e - s) / DAY) + 1;
  const lastOfMonth = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 0)).getUTCDate();
  if (s.getUTCDate() === 1 && e.getUTCDate() === lastOfMonth && s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear())
    return { word: 'month', title: `Month of ${MONTHS[s.getUTCMonth()]} ${s.getUTCFullYear()}` };
  if (days === 7) return { word: 'week', title: `Week of ${weekLabel(s, e)}` };
  return { word: 'period', title: rangeLabel(state.rangeStart, state.rangeEnd) };
}

// Group content into per-format stats (count, total + average views/engagement),
// ranked by average views. Used to surface which formats actually perform.
function typeStats(items) {
  const m = {};
  for (const c of items) {
    const t = c.type || 'Other';
    (m[t] = m[t] || { type: t, n: 0, views: 0, eng: 0 });
    m[t].n++; m[t].views += c.views || 0; m[t].eng += c.eng || 0;
  }
  return Object.values(m).map((x) => ({ ...x, avg: x.n ? x.views / x.n : 0, avgEng: x.n ? x.eng / x.n : 0 }));
}
const contentIn = (p, s, e) => (state.data.content || []).filter((c) => (p === '*' || c.platform === p) && c.date >= s && c.date <= e);

// Richer, single-platform deep-dive (shown when one platform is focused).
function renderFocusedOverview(p, start, end, info) {
  const cur = state.curTotals[p] || {}, prv = state.priorTotals[p] || {};
  const v = cur.views || 0, vPrev = prv.views || 0;
  const r = supports(p, 'reach') ? (cur.reach || 0) : null;
  const watch = supports(p, 'watchTime') ? (cur.watchTime || 0) : null;
  const newFollowers = supports(p, 'newFollowers') ? cur.newFollowers : null;
  const totalFollowers = supports(p, 'totalFollowers') ? cur.totalFollowers : null;
  const dvV = deltaPct(v, vPrev);
  const items = contentIn(p, start, end);
  const prevItems = contentIn(p, state.priorRange.start, state.priorRange.end);
  const eng = items.reduce((s, c) => s + (c.eng || 0), 0);
  const engPrev = prevItems.reduce((s, c) => s + (c.eng || 0), 0);
  const posts = items.length, postsPrev = prevItems.length;
  const avg = posts ? v / posts : 0, avgPrev = postsPrev ? vPrev / postsPrev : 0;
  const top = items.slice().sort((a, b) => (b.views || 0) - (a.views || 0));
  let best = null; for (const b of (state.series[p] || [])) { if (b.views > 0 && (!best || b.views > best.views)) best = b; }

  $('#overviewTitle').textContent = `Overall analysis — ${nameOf(p)} · ${info.title}`;
  let html = `<p class="ov-headline"><strong>${nameOf(p)}</strong> got <strong>${fmt(v)}</strong> views${wordDelta(dvV)}`;
  if (r != null) html += `, <strong>${fmt(r)}</strong> reach${wordDelta(deltaPct(r, prv.reach || 0))}`;
  if (watch != null) html += `, <strong>${fmt(watch / 60)}</strong> hrs watch time${wordDelta(deltaPct(watch, prv.watchTime || 0))}`;
  html += ` vs the previous ${info.word}.</p>`;

  // What contributed — decompose the views change into posting volume, per-post
  // performance, and any single breakout post (all from the data).
  if (dvV != null) {
    const parts = [];
    if (posts !== postsPrev) parts.push(`${posts > postsPrev ? 'more' : 'fewer'} posts (${posts} vs ${postsPrev})`);
    if (avgPrev > 0 && Math.abs(avg - avgPrev) / avgPrev >= 0.15) parts.push(`${avg > avgPrev ? 'higher' : 'lower'} views per post (${fmt(Math.round(avg))} vs ${fmt(Math.round(avgPrev))})`);
    if (top[0] && v > 0 && (top[0].views || 0) / v >= 0.4) parts.push(`one post driving ${Math.round(top[0].views / v * 100)}% of views (${linkedTop(top[0])})`);
    const verb = dvV >= 0.02 ? `up ${(dvV * 100).toFixed(0)}%` : dvV <= -0.02 ? `down ${(Math.abs(dvV) * 100).toFixed(0)}%` : 'about flat';
    html += `<p class="ov-reason"><strong>What contributed:</strong> views ${verb}.${parts.length ? ' Driven by: ' + parts.join('; ') + '.' : ''}</p>`;
  }

  // Quick benchmarks.
  const stats = [`<strong>${fmt(eng)}</strong> engagements${wordDelta(deltaPct(eng, engPrev))}`];
  if (v > 0) stats.push(`${(eng / v * 100).toFixed(1)}% engagement rate`);
  if (posts) stats.push(`${fmt(Math.round(avg))} avg views per post`);
  if (newFollowers != null) stats.push(`${fmtFull(newFollowers)} new followers`);
  if (totalFollowers != null) stats.push(`${fmtFull(totalFollowers)} total followers`);
  if (best) stats.push(`best ${GRAN_NOUN[state.granularity]}: ${escapeHtml(best.label)} (${fmt(best.views)} views)`);
  html += `<p class="ov-reason">${stats.join(' · ')}.</p>`;

  // What's working — by format (ranked by avg views), so they know what to make more of.
  const ts = typeStats(items).sort((a, b) => b.views - a.views);
  if (ts.length > 1) {
    html += `<p class="ov-sub">What's working: top formats by total views</p><ul class="ov-fmt">`;
    for (const t of ts) html += `<li><strong>${escapeHtml(t.type)}</strong>: ${fmt(t.views)} views from ${t.n} ${t.n === 1 ? 'post' : 'posts'} · ${fmt(Math.round(t.avg))} avg views · ${fmt(Math.round(t.avgEng))} avg engagements</li>`;
    html += `</ul>`;
  }

  if (top.length) {
    html += `<p class="ov-sub">Top posts this ${info.word}</p><ol class="ov-top-list">`;
    for (const c of top.slice(0, 3)) {
      let m = `${escapeHtml(c.type || '')} · ${fmt(c.views)} views`;
      if (c.reach != null) m += ` · ${fmt(c.reach)} reach`;
      m += ` · ${fmt(c.eng)} engagements`;
      html += `<li>${linkedTop(c)} <span class="ov-top-meta">${m}</span></li>`;
    }
    html += `</ol>`;
  } else {
    html += `<p class="ov-inactive">No posts were published in this range.</p>`;
  }
  $('#overview').innerHTML = html;
}

function renderOverview() {
  const el = $('#overview');
  if (!el) return;
  const start = state.rangeStart, end = state.rangeEnd;
  const ps = platforms();
  const info = periodInfo();
  if (ps.length && ps.every(isPendingPlatform)) {
    $('#overviewTitle').textContent = `Overall analysis - ${info.title}`;
    el.innerHTML = '<p class="ov-headline"><strong>TikTok totals are connected.</strong> Top content is unavailable until the Supermetrics post-level query stops timing out.</p>';
    return;
  }
  if (ps.length === 1) { renderFocusedOverview(ps[0], start, end, info); return; }
  $('#overviewTitle').textContent = `Overall analysis — ${info.title}`;

  const tv = totalAt('views', 0), dv = deltaPct(tv, totalAt('views', 1));
  const tr = totalAt('reach', 0), dr = deltaPct(tr, totalAt('reach', 1));
  const anyReach = ps.some((p) => supports(p, 'reach'));

  // Per-platform rollup — straight from the API totals and content list.
  const rows = ps.map((p) => {
    const cur = state.curTotals[p] || {}, prv = state.priorTotals[p] || {};
    const v = supports(p, 'views') ? (cur.views || 0) : null;
    const r = supports(p, 'reach') ? (cur.reach || 0) : null;
    const watch = supports(p, 'watchTime') ? (cur.watchTime || 0) : null;
    const newFollowers = supports(p, 'newFollowers') ? cur.newFollowers : null;
    const totalFollowers = supports(p, 'totalFollowers') ? cur.totalFollowers : null;
    const top = (state.data.content || [])
      .filter((c) => c.platform === p && c.date >= start && c.date <= end)
      .sort((a, b) => (b.views || 0) - (a.views || 0))[0] || null;
    return {
      p, v, r, watch, newFollowers, totalFollowers, top,
      dViews: v == null ? null : v - (prv.views || 0),
      dvViews: v == null ? null : deltaPct(v, prv.views || 0),
      dvReach: r != null ? deltaPct(r, prv.reach || 0) : null,
      dvWatch: watch != null ? deltaPct(watch, prv.watchTime || 0) : null,
    };
  });
  const active = rows.filter((x) => (x.v || 0) > 0 || (x.r || 0) > 0 || (x.watch || 0) > 0);
  const inactive = rows.filter((x) => !active.includes(x));
  const scopeLabel = ps.length === allPlatforms().length ? 'all platforms' : ps.map(nameOf).join(', ');

  // Headline — totals over the selected range vs the previous one.
  let html = `<p class="ov-headline">Across ${escapeHtml(scopeLabel)}: <strong>${fmt(tv)}</strong> views${wordDelta(dv)}` +
    `${anyReach ? `, <strong>${fmt(tr)}</strong> reach${wordDelta(dr)}` : ''} vs the previous ${info.word}.</p>`;

  // Biggest mover (data only): the platform whose views changed most, and — if one
  // post accounts for 40%+ of its views — a link to that post.
  const driver = rows.filter((x) => x.dvViews != null && x.dViews !== 0).sort((a, b) => Math.abs(b.dViews) - Math.abs(a.dViews))[0];
  if (driver) {
    let line = `<strong>${nameOf(driver.p)}</strong> had the biggest change in views${wordDelta(driver.dvViews)}`;
    if (driver.top && driver.v > 0 && (driver.top.views || 0) / driver.v >= 0.4) {
      line += `, mostly from ${linkedTop(driver.top)} (${fmt(driver.top.views)} views)`;
    }
    html += `<p class="ov-reason"><strong>Biggest change:</strong> ${line}.</p>`;
  }

  // Best-performing format across the shown platforms (what to make more of).
  const shownItems = (state.data.content || []).filter((c) => ps.includes(c.platform) && c.date >= start && c.date <= end);
  const fts = typeStats(shownItems).filter((t) => t.n >= 3).sort((a, b) => b.avg - a.avg); // only formats with a real sample
  if (fts.length > 1) {
    const lo = fts[fts.length - 1];
    html += `<p class="ov-reason"><strong>Best format:</strong> ${escapeHtml(fts[0].type)} averaged <strong>${fmt(Math.round(fts[0].avg))}</strong> views per post (${fts[0].n} posts); lowest was ${escapeHtml(lo.type)} at ${fmt(Math.round(lo.avg))}.</p>`;
  }

  // One plain line per active platform (TikTok included whenever it has data).
  html += '<ul class="ov-list">';
  for (const x of active) {
    const parts = [];
    if (x.v != null) parts.push(`${fmt(x.v)} views${wordDelta(x.dvViews)}${tv > 0 ? ` (${Math.round(x.v / tv * 100)}% of total)` : ''}`);
    else parts.push('content views unavailable');
    let s = parts.join(', ');
    if (x.r != null) s += `, ${fmt(x.r)} reach${wordDelta(x.dvReach)}`;
    if (x.watch != null) s += `, ${fmt(x.watch / 60)} hrs watch time${wordDelta(x.dvWatch)}`;
    if (x.newFollowers != null) s += `, ${fmtFull(x.newFollowers)} new followers`;
    if (x.totalFollowers != null) s += `, ${fmtFull(x.totalFollowers)} total followers`;
    const top = x.top ? ` Top post: ${linkedTop(x.top)} (${fmt(x.top.views)} views).` : '';
    html += `<li><span class="ov-dot" style="background:${PLATFORM_COLORS[x.p] || '#888'}"></span>` +
      `<strong>${nameOf(x.p)}</strong> got ${s}.${top}</li>`;
  }
  html += '</ul>';
  if (inactive.length) html += `<p class="ov-inactive">No activity in this range on: ${inactive.map((x) => nameOf(x.p)).join(', ')}.</p>`;

  el.innerHTML = html;
}

function analysisDeltaWords(d) {
  if (d == null) return 'no prior comparison';
  if (Math.abs(d) < 0.015) return 'about flat';
  const pct = (Math.abs(d) * 100).toFixed(Math.abs(d) < 0.1 ? 1 : 0);
  return `${d > 0 ? 'up' : 'down'} ${pct}%`;
}

function analysisDeltaHtml(d) {
  if (d == null) return '<span class="ov-delta flat">(no prior)</span>';
  if (Math.abs(d) < 0.015) return '<span class="ov-delta flat">(flat)</span>';
  return `<span class="ov-delta ${d > 0 ? 'up' : 'down'}">(${analysisDeltaWords(d)})</span>`;
}

function itemViews(items) {
  return items.reduce((sum, item) => sum + (item.views || 0), 0);
}

function classifyCreativeTheme(item) {
  const text = `${item?.title || ''} ${item?.type || ''}`.toLowerCase();
  const has = (terms) => terms.some((term) => text.includes(term));
  if (has(['cesar', 'mealtime', 'feeding', 'routine', 'high-drive', 'food-focused', 'food is', 'patience', 'structure', 'dog psychology', 'brakes', 'gas pedal', 'energy'])) {
    return 'Cesar behavior/routine';
  }
  if (has(['tear stain', 'skin', 'coat', 'allerg', 'itch', 'digestion', 'belly', 'stool', 'joint', 'slow down', 'stress', 'healthy', 'happy-go-lucky', 'what causes', 'what does', 'signs of', 'why do dogs', 'bite', 'tail', 'chase', 'chew', 'aging'])) {
    return 'Dog-owner problem hook';
  }
  if (has(['supports', 'supplement', 'formula', 'ingredient', 'offers', 'calm surrender', 'calm confidence', 'skin magic', 'puppy defense'])) {
    return 'Product support claim';
  }
  if (String(item?.type || '').toLowerCase().includes('short')) return 'General short-form clip';
  return item?.type || 'Other';
}

function contentTitle(item) {
  const text = (item?.title || `${nameOf(item?.platform || '')} post`).replace(/\s+/g, ' ').trim();
  return text.length > 92 ? `${text.slice(0, 89)}...` : text;
}

function contentInlineLink(item) {
  if (!item) return '';
  const title = escapeHtml(contentTitle(item));
  const meta = `${nameOf(item.platform)} - ${fmtFull(item.views || 0)} views`;
  const label = item.url && item.url !== '#'
    ? `<a class="ov-example-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${title}</a>`
    : `<span>${title}</span>`;
  return `${label} <span class="ov-example-meta">(${escapeHtml(meta)})</span>`;
}

function themeExamples(items, theme, count = 2, lowFirst = false) {
  if (!theme) return [];
  const score = (item) => {
    const views = item.views || 0;
    return lowFirst && views === 0 ? Number.MAX_SAFE_INTEGER : views;
  };
  return items
    .filter((item) => classifyCreativeTheme(item) === theme.label)
    .sort((a, b) => lowFirst ? score(a) - score(b) : score(b) - score(a))
    .slice(0, count);
}

function inlineExamples(items) {
  return items.map(contentInlineLink).filter(Boolean).join('; ');
}

function rowsInRange(p, start, end) {
  return (state.data?.metrics?.[p]?.daily || []).filter((row) => row.date >= start && row.date <= end);
}

function sumField(rows, key) {
  return rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
}

function shortDate(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function activeDateSummary(rows, key) {
  const dates = rows.filter((row) => Number(row[key]) > 0).map((row) => row.date);
  if (!dates.length) return '';
  if (dates.length <= 4) return dates.map(shortDate).join(', ');
  return `${dates.length} days from ${shortDate(dates[0])} to ${shortDate(dates[dates.length - 1])}`;
}

function zeroDateSummary(rows, key) {
  const zeroDates = rows.filter((row) => Number(row[key] || 0) === 0).map((row) => row.date);
  if (!zeroDates.length) return '';
  if (rows.length <= 7) return `0 on ${zeroDates.map(shortDate).join(', ')}`;
  const activeDates = rows.filter((row) => Number(row[key]) > 0).map((row) => row.date);
  if (!activeDates.length) return '0 for the whole range';
  const lastActive = activeDates[activeDates.length - 1];
  const trailingZeros = zeroDates.filter((date) => date > lastActive);
  if (trailingZeros.length) return `0 after ${shortDate(lastActive)}`;
  return `${zeroDates.length} zero-ad days in the range`;
}

function paidImpactItems(ps, start, end) {
  const items = [];

  if (ps.includes('facebook')) {
    const current = rowsInRange('facebook', start, end);
    const prior = rowsInRange('facebook', state.priorRange.start, state.priorRange.end);
    const paid = sumField(current, 'paidViews');
    const priorPaid = sumField(prior, 'paidViews');
    if (paid > 0) {
      items.push(`Facebook paid views changed from ${fmtFull(priorPaid)} to ${fmtFull(paid)}. The main Facebook Views number still shows organic media views.`);
    } else if (priorPaid > 0) {
      items.push(`Facebook paid views went from ${fmtFull(priorPaid)} to 0. Facebook Views are organic here, so paid traffic is background context.`);
    }
  }

  if (ps.includes('youtube')) {
    const current = rowsInRange('youtube', start, end);
    const prior = rowsInRange('youtube', state.priorRange.start, state.priorRange.end);
    const adViews = sumField(current, 'adViews');
    const adWatch = sumField(current, 'adWatchTime');
    const priorAdViews = sumField(prior, 'adViews');
    if (adViews > 0) {
      const active = activeDateSummary(current, 'adViews');
      const zeroSummary = zeroDateSummary(current, 'adViews');
      let line = `YouTube ad views changed from ${fmtFull(priorAdViews)} to ${fmtFull(adViews)}`;
      if (active) line += `, active on ${active}`;
      if (adWatch > 0) line += `, with ${fmtFull(adWatch)} watched minutes`;
      if (zeroSummary) line += `. Ad traffic was ${zeroSummary}`;
      line += '. Dashboard YouTube views are separate from ad traffic.';
      items.push(line);
    } else if (priorAdViews > 0) {
      items.push(`YouTube ad views went from ${fmtFull(priorAdViews)} to 0.`);
    }
  }

  return items;
}

function analysisRowHtml(label, bodyHtml, cls = '') {
  return `<div class="analysis-row${cls ? ` ${cls}` : ''}"><div class="analysis-label">${escapeHtml(label)}</div><div class="analysis-copy">${bodyHtml}</div></div>`;
}

function analysisBulletListHtml(items) {
  return `<ul class="analysis-mini-list">${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

function movementWord(n) {
  if (n == null) return 'had no prior period to compare against';
  if (Math.abs(n) < 0.015) return 'were flat';
  return `were ${analysisDeltaWords(n)}`;
}

function viewChangePhrase(n) {
  if (!n) return 'did not change';
  return n > 0 ? `gained ${fmtFull(n)} views` : `lost ${fmtFull(Math.abs(n))} views`;
}

function totalMovementHtml(rows, totalViews, priorViews, info, ps, start, end) {
  const dTotal = deltaPct(totalViews, priorViews);
  const bullets = [];
  if (dTotal == null) {
    const leader = rows
      .filter((row) => row.views != null)
      .sort((a, b) => (b.views || 0) - (a.views || 0))[0];
    bullets.push(`There is no prior ${info.word} to compare against.`);
    if (leader && totalViews) bullets.push(`<strong>${nameOf(leader.p)}</strong> drove the most views in this range.`);
    return analysisRowHtml('Why it changed', analysisBulletListHtml(bullets));
  }
  const movers = rows
    .filter((row) => row.views != null && row.priorViews != null && row.viewChange)
    .sort((a, b) => Math.abs(b.viewChange) - Math.abs(a.viewChange));

  bullets.push(`Total views ${movementWord(dTotal)} from the prior ${info.word}.`);
  if (movers.length) {
    const primary = dTotal != null && dTotal < 0
      ? movers.filter((row) => row.viewChange < 0).sort((a, b) => a.viewChange - b.viewChange)[0] || movers[0]
      : movers.filter((row) => row.viewChange > 0).sort((a, b) => b.viewChange - a.viewChange)[0] || movers[0];
    const counterMove = dTotal != null && dTotal < 0
      ? movers.filter((row) => row.viewChange > 0).sort((a, b) => b.viewChange - a.viewChange)[0]
      : movers.filter((row) => row.viewChange < 0).sort((a, b) => a.viewChange - b.viewChange)[0];
    bullets.push(`Biggest reason: <strong>${nameOf(primary.p)}</strong> ${viewChangePhrase(primary.viewChange)} (${analysisDeltaWords(primary.dViews)}).`);
    if (counterMove) {
      const label = dTotal < 0 ? 'What helped' : 'What pulled it down';
      bullets.push(`${label}: <strong>${nameOf(counterMove.p)}</strong> ${viewChangePhrase(counterMove.viewChange)}.`);
    }
  }
  for (const item of paidImpactItems(ps, start, end)) bullets.push(`<strong>Paid/ad note:</strong> ${escapeHtml(item)}`);
  return analysisRowHtml('Why it changed', analysisBulletListHtml(bullets));
}

function platformMovementHtml(p, cur, prv, start, end, info) {
  const bullets = [];
  if (supports(p, 'views')) {
    const views = cur.views || 0;
    const priorViews = prv.views || 0;
    bullets.push(`Views ${movementWord(deltaPct(views, priorViews))} from the prior ${info.word}.`);
  }
  const posts = cur.posts || 0;
  const priorPosts = prv.posts || 0;
  if (posts || priorPosts) {
    bullets.push(`Posting volume: ${fmtFull(posts)} posts this ${info.word} vs ${fmtFull(priorPosts)} in the prior ${info.word}.`);
    if (posts && priorPosts && supports(p, 'views')) {
      const avg = (cur.views || 0) / posts;
      const priorAvg = (prv.views || 0) / priorPosts;
      const avgDelta = deltaPct(avg, priorAvg);
      if (avgDelta != null && Math.abs(avgDelta) >= 0.15) bullets.push(`Average views per post were ${analysisDeltaWords(avgDelta)}.`);
    }
  }
  for (const item of paidImpactItems([p], start, end)) bullets.push(`<strong>Paid/ad note:</strong> ${escapeHtml(item)}`);
  return analysisRowHtml('Why it changed', analysisBulletListHtml(bullets));
}

function themeTakeaway(theme) {
  if (!theme) return '';
  if (theme.label === 'Dog-owner problem hook') return 'These posts start with a problem dog owners already care about, then bring in the product.';
  if (theme.label === 'Cesar behavior/routine') return 'These posts work because Cesar gives people a clear behavior lesson before the product appears.';
  if (theme.label === 'Product support claim') return 'Product claims can work, but they perform better when the opening starts with a dog problem.';
  return 'The best posts give viewers a clear reason to care right away.';
}

function readableThemeLabel(label) {
  if (label === 'General short-form clip') return 'Short-form clips';
  if (label === 'Dog-owner problem hook') return 'Dog-owner problem hooks';
  if (label === 'Cesar behavior/routine') return 'Cesar behavior/routine clips';
  if (label === 'Product support claim') return 'Product support claims';
  return label || 'This pattern';
}

function creativeThemeStats(items) {
  const totalViews = itemViews(items);
  const map = {};
  for (const item of items) {
    const label = classifyCreativeTheme(item);
    const row = map[label] || { label, n: 0, views: 0, eng: 0 };
    row.n += 1;
    row.views += item.views || 0;
    row.eng += item.eng || 0;
    map[label] = row;
  }
  return Object.values(map).map((row) => ({
    ...row,
    avg: row.n ? row.views / row.n : 0,
    avgEng: row.n ? row.eng / row.n : 0,
    share: totalViews ? row.views / totalViews : 0
  }));
}

function bestTheme(themes, itemCount) {
  const minSample = itemCount >= 12 ? 3 : itemCount >= 6 ? 2 : 1;
  const candidates = themes.filter((theme) => theme.n >= minSample);
  return (candidates.length ? candidates : themes).slice().sort((a, b) => b.avg - a.avg)[0] || null;
}

function weakTheme(themes, winner) {
  return themes
    .filter((theme) => theme.label !== winner?.label && theme.n >= 2)
    .sort((a, b) => a.avg - b.avg)[0] || null;
}

function creativeActionsFor(theme, weak, ps) {
  const sourceLine = 'Pull first from existing Cesar product, selfie, Q&A, Journey, and UGC B-roll footage before requesting a new shoot.';
  if (!theme) return ['Keep testing hooks until there is enough post-level data to identify a repeatable winner.', sourceLine];
  const actions = [];
  if (theme.label === 'Cesar behavior/routine') {
    actions.push('Cut more Cesar-led routine clips: behavior lesson first, supplement support second.');
    actions.push('New video idea if footage is missing: Cesar reacts to a food-focused or high-energy dog, names the behavior, then ties it to one formula.');
  } else if (theme.label === 'Dog-owner problem hook') {
    actions.push('Build the next batch around one visible dog-owner problem in the first second: tear stains, itching, loose stool, slowing down, or anxiety.');
    actions.push('Use UGC B-roll for the symptom visual, then add Cesar/product footage after the hook lands.');
  } else if (theme.label === 'Product support claim') {
    actions.push('Keep the product proof, but rewrite the opening around the dog problem before naming the supplement.');
  } else {
    actions.push('Repeat the winning hook structure and test it across Instagram, TikTok, and YouTube Shorts.');
  }
  if (weak?.label === 'Product support claim') actions.push('Reduce product-first openings unless they are paired with a specific symptom or behavior.');
  if (ps.includes('youtube')) actions.push('For YouTube, reuse the strongest short-form hooks but judge quality with watch time because reach is unavailable.');
  actions.push(sourceLine);
  const unique = [...new Set(actions)];
  return [...unique.filter((line) => line !== sourceLine).slice(0, 3), sourceLine];
}

function platformReadRows(ps, start, end) {
  return ps.map((p) => {
    const cur = state.curTotals[p] || {};
    const prv = state.priorTotals[p] || {};
    const posts = cur.posts || 0;
    const views = supports(p, 'views') ? (cur.views || 0) : null;
    const reach = supports(p, 'reach') ? (cur.reach || 0) : null;
    const watch = supports(p, 'watchTime') ? (cur.watchTime || 0) : null;
    const newFollowers = supports(p, 'newFollowers') ? cur.newFollowers : null;
    const items = contentIn(p, start, end);
    return {
      p, posts, views, reach, watch, newFollowers,
      priorViews: prv.views || 0,
      viewChange: views == null ? null : (views || 0) - (prv.views || 0),
      avg: posts ? (views || 0) / posts : 0,
      dViews: views == null ? null : deltaPct(views, prv.views || 0),
      dReach: reach == null ? null : deltaPct(reach, prv.reach || 0),
      dWatch: watch == null ? null : deltaPct(watch, prv.watchTime || 0),
      dFollowers: newFollowers == null ? null : deltaPct(newFollowers, prv.newFollowers || 0),
      contentCount: items.length
    };
  });
}

function creativeAnalysisHtml(ps, start, end, info) {
  const items = (state.data.content || []).filter((c) => ps.includes(c.platform) && c.date >= start && c.date <= end);
  if (!items.length) {
    return analysisRowHtml('Content signal', 'No posted content is available in this range, so there is not enough content data to explain the movement.');
  }

  const themes = creativeThemeStats(items);
  const winner = bestTheme(themes, items.length);
  const weak = weakTheme(themes, winner);
  const winnerExamples = themeExamples(items, winner, 2);
  const weakExamples = themeExamples(items, weak, 1, true);
  const actions = creativeActionsFor(winner, weak, ps);

  const rows = [];
  if (items.length < 4) {
    rows.push(analysisRowHtml('Data note', `Only ${items.length} post${items.length === 1 ? '' : 's'} had post-level data, so this is a small sample.`));
  }

  if (winner) {
    let body = `<p>Top pattern: <strong>${escapeHtml(readableThemeLabel(winner.label))}</strong>.</p>`;
    body += `<p>${escapeHtml(themeTakeaway(winner))}</p>`;
    if (winnerExamples.length) body += `<div class="analysis-examples"><strong>Examples:</strong> ${inlineExamples(winnerExamples)}.</div>`;
    rows.push(analysisRowHtml('What worked', body));
  }
  if (weak) {
    let body = `<p>Weaker pattern: <strong>${escapeHtml(readableThemeLabel(weak.label))}</strong>. The opening likely needs to be clearer or more problem-led.</p>`;
    if (weakExamples.length) body += `<div class="analysis-examples"><strong>Example to improve:</strong> ${inlineExamples(weakExamples)}.</div>`;
    rows.push(analysisRowHtml('What to improve', body));
  }

  rows.push(analysisRowHtml('Do next', `<p class="analysis-basis">Based on the content patterns above and the footage we have available.</p><ol class="ov-action-list">${actions.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ol>`, 'analysis-actions-row'));
  return rows.join('');
}

function renderCreativeFocusedOverview(p, start, end, info) {
  const el = $('#overview');
  const cur = state.curTotals[p] || {};
  const prv = state.priorTotals[p] || {};

  $('#overviewTitle').textContent = `Content analysis - ${nameOf(p)} - ${info.title}`;
  let html = '<div class="analysis-quick">';
  html += platformMovementHtml(p, cur, prv, start, end, info);
  html += creativeAnalysisHtml([p], start, end, info);
  html += '</div>';
  el.innerHTML = html;
}

function renderCreativeOverview() {
  const el = $('#overview');
  if (!el) return;
  const start = state.rangeStart;
  const end = state.rangeEnd;
  const ps = platforms();
  const info = periodInfo();
  if (ps.length === 1 && !state.totalOnly) {
    renderCreativeFocusedOverview(ps[0], start, end, info);
    return;
  }

  $('#overviewTitle').textContent = `Content analysis - ${info.title}`;
  const totalViews = totalAt('views', 0);
  const priorViews = totalAt('views', 1);
  const rows = platformReadRows(ps, start, end);

  let html = '<div class="analysis-quick">';
  html += totalMovementHtml(rows, totalViews, priorViews, info, ps, start, end);
  html += creativeAnalysisHtml(ps, start, end, info);
  html += '</div>';

  el.innerHTML = html;
}

function renderContent() {
  if (!state.data.content) return;
  const focus = focusedPlatform();
  const shown = platforms();
  const canSortReach = focus
    ? supports(focus, 'reach')
    : shown.some((p) => supports(p, 'reach'));
  const sortOptions = [
    ['views', 'By views'],
    ...(canSortReach ? [['reach', 'By reach']] : []),
    ...(focus === 'youtube' ? [['watchTime', 'By watch time']] : []),
    ['eng', 'By engagement'],
  ];
  if (!sortOptions.some(([value]) => value === state.contentSort)) state.contentSort = sortOptions[0][0];
  $('#contentSort').innerHTML = sortOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  $('#contentSort').value = state.contentSort;

  const period = { start: state.rangeStart, end: state.rangeEnd, label: rangeLabel(state.rangeStart, state.rangeEnd) };
  const key = state.contentSort;

  // Top 3 per platform across the selected range, grouped.
  const contentScore = (c) => {
    const primary = c[key];
    if (primary != null && primary !== 0) return primary;
    if (key === 'views' && c.platform === 'facebook') return c.eng || 0;
    return primary || 0;
  };
  const groups = platforms().map((p) => {
    if (isPendingPlatform(p)) return { p, top: [], pending: true };
    const top = state.data.content
      .filter((c) => c.platform === p && c.date >= period.start && c.date <= period.end)
      .sort((a, b) => contentScore(b) - contentScore(a))
      .slice(0, 3);
    return { p, top };
  });

  const contentColumns = (platform, rows) => {
    const base = [
      { label: '#', cls: 'rank-col', value: (_c, i) => i + 1 },
      { label: 'Content', cls: 'content-col', value: (c) => {
        const label = c.title && c.title.trim() ? c.title : `${capWord(c.platform)} post`;
        return c.url && c.url !== '#'
          ? `<a class="content-link" href="${escapeHtml(c.url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`
          : escapeHtml(label);
      } },
      { label: 'Type', cls: 'type-col', value: (c) => `<span class="type-tag">${escapeHtml(c.type || '-')}</span>` },
      { label: 'Date posted', cls: 'date-col', value: (c) => c.date },
    ];
    base.push({ label: 'Views', cls: 'num metric-col', value: (c) => fmtFull(c.views) });
    if (supports(platform, 'reach') && rows.some((c) => c.reach != null)) base.push({ label: 'Reach', cls: 'num metric-col', value: (c) => fmtFull(c.reach) });
    if (platform === 'youtube') base.push({ label: 'Watch time', cls: 'num metric-col', value: (c) => c.watchTime == null ? '-' : `${fmt(c.watchTime / 60)} hrs` });
    base.push({ label: 'Engagement', cls: 'num metric-col', value: (c) => fmtFull(c.eng) });
    return base;
  };

  const tableHtml = (platform, rows) => {
    const cols = contentColumns(platform, rows);
    return `<div class="table-wrap"><table class="posts-table">
      <thead><tr>${cols.map((col) => `<th${col.cls ? ` class="${col.cls}"` : ''}>${escapeHtml(col.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((c, i) => `<tr>${cols.map((col) => `<td data-label="${escapeHtml(col.label === '#' ? 'Rank' : col.label)}"${col.cls ? ` class="${col.cls}"` : ''}>${col.value(c, i)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  };

  $('#contentGroups').innerHTML = groups.map((g) => `
    <div class="content-group">
      <div class="cg-head" style="border-bottom-color:${PLATFORM_COLORS[g.p] || '#ccc'}">
        <span class="cg-dot" style="background:${PLATFORM_COLORS[g.p] || '#888'}"></span>
        <span class="cg-name">${nameOf(g.p)}</span>
      </div>
      ${g.pending
        ? `<p class="cg-empty">TikTok totals are connected, but TikTok top content is not available from Supermetrics yet.</p>`
        : g.top.length
        ? tableHtml(g.p, g.top)
        : `<p class="cg-empty">${g.p === 'tiktok' ? 'TikTok totals are connected, but TikTok post-level content is not available from Supermetrics yet.' : `No posts in ${escapeHtml(period.label)}.`}</p>`}
    </div>
  `).join('');
}

// The platform selector is a toggle group: Total is a single combined line;
// platform chips can be selected together.
function currentFocus() {
  if (state.totalOnly) return 'total';
  if (state.selectedPlatforms && state.selectedPlatforms.length === 1) return state.selectedPlatforms[0];
  return 'selected';
}
function setFocus(v) {
  if (v === 'total') {
    state.selectedPlatforms = [];
    state.totalOnly = true;
    render();
    return;
  }
  const selected = new Set(Array.isArray(state.selectedPlatforms) ? state.selectedPlatforms : []);
  if (state.totalOnly) selected.clear();
  if (selected.has(v)) selected.delete(v);
  else selected.add(v);
  const all = allPlatforms().filter((p) => !isPendingPlatform(p));
  state.selectedPlatforms = all.filter((p) => selected.has(p));
  state.totalOnly = state.selectedPlatforms.length === 0;
  render();
}

function renderPlatformFilter() {
  const all = allPlatforms();
  if (all.length <= 1) { $('#platformFilter').innerHTML = ''; return; }
  const selected = new Set(Array.isArray(state.selectedPlatforms) ? state.selectedPlatforms : []);
  const chip = (val, label, dot, on) =>
    `<button type="button" class="pf-chip ${on ? 'on' : ''}" data-focus="${val}" aria-pressed="${on ? 'true' : 'false'}">` +
    (dot != null ? `<span class="pf-dot" style="background:${dot}"></span>` : '') + `${label}</button>`;
  // [ Total ] [ Instagram ] [ Facebook ] [ YouTube ] [ TikTok ]
  $('#platformFilter').innerHTML = '<span class="pf-label">Show:</span>' +
    chip('total', 'Total', null, state.totalOnly) +
    all.map((p) => chip(p, nameOf(p), PLATFORM_COLORS[p] || '#888', !state.totalOnly && selected.has(p))).join('');
  for (const p of all) {
    if (!isCarriedForward(p)) continue;
    const btn = $(`#platformFilter [data-focus="${p}"]`);
    if (btn) btn.insertAdjacentHTML('beforeend', ' <span class="pf-stale">pending</span>');
  }
}

function renderChartVisibility() {
  $('#viewsCard').hidden = false;
  $('#postsCard').hidden = false;
  $('#reachCard').hidden = !platforms().some((p) => supports(p, 'reach'));
  $('#watchCard').hidden = state.totalOnly || !platforms().includes('youtube');
}

function renderKpis() {
  const noun = GRAN_NOUN[state.granularity];

  // Heading reflects the actual scope (all platforms, or the filtered subset).
  const showing = platforms();
  const pendingOnly = showing.length > 0 && showing.every(isPendingPlatform);
  const scope = state.totalOnly ? 'Total' : showing.map(nameOf).join(', ');
  $('#kpisTitle').innerHTML = `Metric Totals <span class="scope">(${scope})</span>`;

  $('#kpis').innerHTML = visibleMetrics().map((m) => {
    const curr = totalAt(m.key, 0);
    const prev = totalAt(m.key, 1);
    const val = pendingOnly || (m.key === 'watchTime' && curr === 0) ? null : curr;
    const delta = m.showDelta === false ? '' : deltaHtmlWithHelp(curr, prev, m.key);
    return `
      <div class="kpi">
        <div class="label">${m.label}</div>
        <div class="value">${m.fmt(val)}</div>
        <div>${pendingOnly ? '' : delta}</div>
      </div>`;
  }).join('');
}

function renderPlatformCards() {
  const wrap = $('#platformCards');
  const section = $('#channelsSection');
  if (!wrap || !section) return;
  const ps = platforms();
  section.hidden = !ps.length;
  if (!ps.length) {
    wrap.innerHTML = '';
    return;
  }

  const metricStat = (label, value, prev, formatter = fmt) => {
    const shown = value == null ? '—' : formatter(value);
    return `<div class="pcard-stat"><span>${escapeHtml(label)}</span><strong>${shown}</strong>${miniDelta(value, prev)}</div>`;
  };

  wrap.innerHTML = ps.map((p) => {
    const cur = state.curTotals[p] || {};
    const prv = state.priorTotals[p] || {};
    const followers = supports(p, 'totalFollowers') ? cur.totalFollowers : null;
    const mainValue = followers == null ? fmt(cur.views || 0) : fmtFull(followers);
    const mainLabel = followers == null ? 'views selected range' : 'total followers';
    const stats = [];
    stats.push(metricStat('Views', cur.views || 0, prv.views || 0, fmt));
    stats.push(metricStat('Posts', cur.posts || 0, prv.posts || 0, fmtFull));
    if (supports(p, 'newFollowers')) stats.push(metricStat('New followers', cur.newFollowers, prv.newFollowers, fmtFull));
    if (supports(p, 'reach')) stats.push(metricStat('Reach', cur.reach || 0, prv.reach || 0, fmt));
    if (supports(p, 'watchTime')) stats.push(metricStat('Watch time', cur.watchTime, prv.watchTime, (v) => fmt(v / 60) + ' hrs'));
    return `
      <article class="pcard ${p}" style="--platform-color:${PLATFORM_COLORS[p] || '#88cc33'}">
        <div class="phead">
          <span class="platform-mark">${escapeHtml(nameOf(p).slice(0, 1))}</span>
          <div>
            <div class="pname">${escapeHtml(nameOf(p))}</div>
          </div>
        </div>
        <div class="pcard-main">
          <strong>${mainValue}</strong>
          <span>${escapeHtml(mainLabel)}</span>
        </div>
        <div class="pcard-stats">${stats.join('')}</div>
      </article>`;
  }).join('');
}

// Clicking a legend item isolates that line (hides the rest); clicking the
// already-isolated item restores all. So clicking "Total" shows only the total.
function isolateLegend(e, item, legend) {
  const ch = legend.chart;
  const idx = item.datasetIndex;
  const clicked = ch.data.datasets[idx] || {};
  const key = clicked.pairKey || clicked.label;
  const visible = ch.data.datasets.map((_, i) => ch.isDatasetVisible(i));
  const pairIndexes = ch.data.datasets
    .map((d, i) => ((d.pairKey || d.label) === key ? i : null))
    .filter((i) => i != null);
  const onlyPair = pairIndexes.length
    && pairIndexes.every((i) => visible[i])
    && visible.filter(Boolean).length === pairIndexes.length;
  ch.data.datasets.forEach((d, i) => ch.setDatasetVisibility(i, onlyPair ? true : (d.pairKey || d.label) === key));
  ch.update();
}

const COMMON_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { onClick: isolateLegend, labels: { color: '#4b5043', boxWidth: 12, font: { size: 11 } } },
    tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${Math.round(c.parsed.y).toLocaleString()}` } }
  },
  scales: {
    x: { ticks: { color: '#717869', maxTicksLimit: 10, font: { size: 10 } }, grid: { color: '#e7ecd6' } },
    // beginAtZero:false + grace lets the line fill the chart height so the
    // slope of the trend is easy to read (auto-fits to whatever is visible).
    y: { beginAtZero: false, grace: '8%', ticks: { color: '#717869', font: { size: 10 }, callback: (v) => fmt(v) }, grid: { color: '#e7ecd6' } }
  }
};

function lineChart(canvasId, labels, datasets) {
  if (charts[canvasId]) charts[canvasId].destroy();
  const theme = chartTheme();
  const opts = JSON.parse(JSON.stringify(COMMON_OPTS));
  opts.plugins.tooltip = COMMON_OPTS.plugins.tooltip;
  opts.plugins.legend.onClick = isolateLegend; // function lost in JSON clone
  opts.plugins.legend.labels.filter = (item, data) => !data.datasets[item.datasetIndex]?.isPrior;
  opts.plugins.legend.labels.color = theme.legend;
  opts.plugins.tooltip.backgroundColor = theme.tooltipBg;
  opts.plugins.tooltip.titleColor = theme.tooltipText;
  opts.plugins.tooltip.bodyColor = theme.tooltipText;
  opts.scales.x.ticks.color = theme.ticks;
  opts.scales.y.ticks.color = theme.ticks;
  opts.scales.x.grid.color = theme.grid;
  opts.scales.y.grid.color = theme.grid;
  opts.scales.y.ticks.callback = COMMON_OPTS.scales.y.ticks.callback;
  // Click a point → spike insight for that line + period.
  opts.onClick = (evt, _els, chart) => {
    const hit = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: false }, true);
    if (hit.length) onPointClick(canvasId, hit[0].datasetIndex, hit[0].index, chart);
  };
  opts.onHover = (evt, els, chart) => { chart.canvas.style.cursor = els.length ? 'pointer' : 'default'; };
  charts[canvasId] = new Chart($('#' + canvasId), { type: 'line', data: { labels, datasets }, options: opts });
}

function hexToRgba(hex, alpha) {
  const raw = String(hex || '').replace('#', '');
  if (raw.length !== 6) return `rgba(75, 80, 67, ${alpha})`;
  const n = parseInt(raw, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function hasValues(values) {
  return values.some((v) => v != null);
}

function priorValuesForPlatform(p, metricKey, scale = 1) {
  return (state.priorSeries[p] || []).map((row) => {
    if (!row || !row._rowCount) return null;
    const value = row[metricKey];
    return value == null ? null : Math.round((value || 0) / scale);
  });
}

function priorTotalValues(ps, metricKey, scale = 1) {
  return state.periods.map((_, i) => {
    let saw = false;
    let sum = 0;
    for (const p of ps) {
      const row = state.priorSeries[p]?.[i];
      if (!row || !row._rowCount) continue;
      const value = row[metricKey];
      if (value == null) continue;
      saw = true;
      sum += value || 0;
    }
    return saw ? Math.round(sum / scale) : null;
  });
}

function hasPriorChartData(metricKey) {
  const ps = platforms().filter((p) => supports(p, metricKey));
  if (!ps.length) return false;
  const scale = metricKey === 'watchTime' ? 60 : 1;
  const values = state.totalOnly
    ? priorTotalValues(ps, metricKey, scale)
    : ps.flatMap((p) => priorValuesForPlatform(p, metricKey, scale));
  return hasValues(values);
}

function currentDataset(label, data, color, width = 2, fill = false) {
  return {
    label, data, pairKey: label,
    borderColor: color, backgroundColor: color + '22',
    tension: 0.3, pointRadius: 2, borderWidth: width, fill
  };
}

function priorDataset(label, data, color) {
  if (!hasValues(data)) return null;
  return {
    label: `${label} prior`, data, pairKey: label, isPrior: true,
    borderColor: hexToRgba(color, 0.38), backgroundColor: 'transparent',
    borderDash: [5, 5], tension: 0.3, pointRadius: 0, pointHoverRadius: 3,
    borderWidth: 2, fill: false
  };
}

function renderTrend(canvasId, metricKey) {
  const labels = state.periods.map((p) => p.label);
  const ps = platforms().filter((p) => supports(p, metricKey));
  // "Total" focus: draw only the combined line, nothing else.
  if (state.totalOnly) {
    const data = labels.map((_, i) => ps.reduce((s, p) => s + (state.series[p][i]?.[metricKey] || 0), 0));
    const total = chartTheme().total;
    const datasets = [currentDataset('Total', data, total, 3, false)];
    const priorLine = priorDataset('Total', priorTotalValues(ps, metricKey), total);
    if (priorLine) datasets.push(priorLine);
    lineChart(canvasId, labels, datasets);
    return;
  }
  const datasets = [];
  for (const p of ps) {
    const label = nameOf(p);
    datasets.push(currentDataset(label, state.series[p].map((x) => x[metricKey] || 0), PLATFORM_COLORS[p], 2, false));
    const priorLine = priorDataset(label, priorValuesForPlatform(p, metricKey), PLATFORM_COLORS[p]);
    if (priorLine) datasets.push(priorLine);
  }
  lineChart(canvasId, labels, datasets);
}

function renderWatchChart() {
  const labels = state.periods.map((p) => p.label);
  const yt = platforms().includes('youtube') ? state.series.youtube : null;
  const data = yt ? yt.map((x) => Math.round((x.watchTime || 0) / 60)) : [];
  const datasets = [currentDataset('Watch time (hrs)', data, PLATFORM_COLORS.youtube, 3, true)];
  const priorLine = priorDataset('Watch time (hrs)', priorValuesForPlatform('youtube', 'watchTime', 60), PLATFORM_COLORS.youtube);
  if (priorLine) datasets.push(priorLine);
  lineChart('watchChart', labels, datasets);
}

function renderTable() {
  const ps = platforms();
  const metrics = visibleMetrics();
  const pendingOnly = ps.length > 0 && ps.every(isPendingPlatform);
  $('#weekTable thead').innerHTML = `<tr><th>Platform</th>${metrics.map((m) => `<th class="num">${escapeHtml(m.label)}</th>`).join('')}<th>Status</th></tr>`;
  $('#weekTable tbody').innerHTML = ps.map((p) => {
    const cells = metrics.map((m) => {
      const curr = platformAt(p, m.key, 0);
      const prev = platformAt(p, m.key, 1);
      if (!supports(p, m.key)) return `<td class="num muted">—</td>`;
      return `<td class="num">${m.fmt(curr)} ${m.showDelta === false ? '' : miniDelta(curr, prev)}</td>`;
    }).join('');
    const status = sourceStatus(p);
    return `<tr class="${status.cls === 'stale' ? 'stale-row' : ''}"><td><span class="pill ${p}">${nameOf(p)}</span></td>${cells}<td><span class="source-badge ${status.cls}">${escapeHtml(status.label)}</span></td></tr>`;
  }).join('');

  const totalCells = metrics.map((m) => {
    const curr = totalAt(m.key, 0);
    const prev = totalAt(m.key, 1);
    const val = m.key === 'watchTime' && curr === 0 ? null : curr;
    return `<td class="num">${m.fmt(val)} ${m.showDelta === false ? '' : miniDelta(curr, prev)}</td>`;
  }).join('');
  const footerStatus = pendingOnly
    ? '<span class="source-badge stale">Pending approval</span>'
    : '<span class="source-badge fresh">Fresh API data</span>';
  $('#weekTable tfoot').innerHTML = `<tr class="total-row"><td>Total</td>${totalCells}<td>${footerStatus}</td></tr>`;
}

// ---------------------------------------------------------------------------
// Spike insight — click a chart point to see what drove that period
// ---------------------------------------------------------------------------
const CHART_METRIC = { postsChart: 'posts', viewsChart: 'views', reachChart: 'reach', watchChart: 'watchTime' };
const METRIC_NOUN = { posts: 'posts', views: 'views', reach: 'reach', watchTime: 'watch time' };
// Which per-post content field maps to the metric. null = not attributable to a single post.
const CONTENT_FIELD = { views: 'views', reach: 'reach', posts: null, watchTime: null };

function platformByName(name) { return allPlatforms().find((p) => nameOf(p) === name) || null; }

function onPointClick(canvasId, datasetIndex, periodIndex, chart) {
  const metricKey = CHART_METRIC[canvasId];
  if (!metricKey) return;
  const dataset = chart.data.datasets[datasetIndex] || {};
  if (dataset.isPrior) return;
  const label = dataset.label || '';
  let platform;
  if (canvasId === 'watchChart') platform = 'youtube';
  else if (label === 'Total') platform = 'total';
  else platform = platformByName(label);
  if (!platform) return;
  // Click a point to open its insight; click the same point again to close it.
  const key = `${platform}|${metricKey}|${periodIndex}`;
  const panel = $('#insightPanel');
  if (!panel.hidden && state.insightKey === key) {
    panel.hidden = true;
    state.insightKey = null;
    return;
  }
  state.insightKey = key;
  showInsight(platform, metricKey, periodIndex);
}

function fmtMetricVal(key, v) {
  if (v == null) return '—';
  if (key === 'watchTime') return fmt(v / 60) + ' hrs';
  if (key === 'posts') return fmtFull(v);
  return fmt(v);
}

function periodFieldTotal(ps, idx, field) {
  return ps.reduce((sum, p) => sum + ((state.series[p] && state.series[p][idx]) ? (state.series[p][idx][field] || 0) : 0), 0);
}

function movementText(wow, factor) {
  if (wow != null && Math.abs(wow) >= 0.15) return wow > 0 ? 'spike' : 'drop';
  if (factor != null && factor >= 1.4) return 'spike';
  if (factor != null && factor <= 0.7) return 'drop';
  return 'normal range';
}

function fmtAdMinutes(minutes) {
  return `${fmt(minutes / 60)} hrs`;
}

function deltaWords(curr, prev) {
  if (!prev && !curr) return '';
  if (!prev && curr) return 'new vs prior period';
  const d = (curr - prev) / prev;
  if (Math.abs(d) < 0.05) return 'about flat vs prior period';
  return `${d > 0 ? 'up' : 'down'} ${(Math.abs(d) * 100).toFixed(0)}% vs prior period`;
}

function adContextHtml(scopePlatforms, metricKey, idx, movement) {
  if (!['views', 'reach', 'watchTime'].includes(metricKey)) return '';
  const prevIdx = idx > 0 ? idx - 1 : null;
  const lines = [];

  if (scopePlatforms.includes('facebook') && (metricKey === 'views' || metricKey === 'reach')) {
    const paid = periodFieldTotal(['facebook'], idx, 'paidViews');
    const prevPaid = prevIdx == null ? 0 : periodFieldTotal(['facebook'], prevIdx, 'paidViews');
    if (paid > 0 || prevPaid > 0) {
      if (metricKey === 'views') {
        lines.push(`Facebook paid media views were ${fmt(paid)} this period${prevIdx == null ? '' : ` (${deltaWords(paid, prevPaid)})`}; the dashboard Views line still uses organic media views.`);
      } else {
        lines.push(`Facebook reach may be affected by paid distribution. Facebook paid media views were ${fmt(paid)} this period${prevIdx == null ? '' : ` (${deltaWords(paid, prevPaid)})`}.`);
      }
    }
  }

  if (scopePlatforms.includes('youtube') && (metricKey === 'views' || metricKey === 'watchTime')) {
    const field = metricKey === 'watchTime' ? 'adWatchTime' : 'adViews';
    const adValue = periodFieldTotal(['youtube'], idx, field);
    const prevAd = prevIdx == null ? 0 : periodFieldTotal(['youtube'], prevIdx, field);
    const ytValue = periodFieldTotal(['youtube'], idx, metricKey);
    const share = ytValue > 0 ? `, about ${Math.round(adValue / ytValue * 100)}% of YouTube ${METRIC_NOUN[metricKey]}` : '';
    const formatted = metricKey === 'watchTime' ? fmtAdMinutes(adValue) : fmt(adValue);
    if (adValue > 0 || prevAd > 0) {
      lines.push(`YouTube advertising traffic contributed ${formatted}${share}${prevIdx == null ? '' : ` (${deltaWords(adValue, prevAd)})`}.`);
    }
  }

  if (!lines.length) return '';
  return `<p class="insight-caveat"><strong>Ad context:</strong> ${lines.map(escapeHtml).join('<br>')}</p>`;
}

function periodDays(period) {
  return Math.round((Date.parse(period.end + 'T00:00:00Z') - Date.parse(period.start + 'T00:00:00Z')) / DAY) + 1;
}

function priorWindow(period) {
  const days = periodDays(period);
  const start = shiftIsoDate(period.start, -days);
  const end = shiftIsoDate(period.end, -days);
  return {
    start,
    end,
    label: days === 1 ? shortDate(start) : rangeLabel(start, end),
  };
}

function scopedRows(scopePlatforms, start, end) {
  return scopePlatforms.flatMap((p) => rowsInRange(p, start, end).map((row) => ({ ...row, platform: p })));
}

function scopedFieldTotal(scopePlatforms, start, end, field) {
  return scopedRows(scopePlatforms, start, end).reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
}

function scopedContent(scopePlatforms, start, end) {
  return (state.data.content || []).filter((c) => scopePlatforms.includes(c.platform) && c.date >= start && c.date <= end);
}

function contentMetricValue(item, field) {
  return Number(item?.[field] || 0);
}

function itemPlatformPrefix(item, platform) {
  return platform === 'total' ? `${nameOf(item.platform)} - ` : '';
}

function contentDriverLine(item, field, platform, label) {
  const title = item.title && item.title.trim() ? item.title : `${capWord(item.platform)} post`;
  const link = item.url && item.url !== '#'
    ? `<a class="content-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(title)}</a>`
    : escapeHtml(title);
  const value = contentMetricValue(item, field);
  const metric = field === 'watchTime' ? fmtMetricVal('watchTime', value) : fmt(value);
  return `<li><span class="insight-driver-label">${escapeHtml(label)}</span>${itemPlatformPrefix(item, platform)}${link}<span class="ins-meta">${escapeHtml(item.type || 'post')} - ${metric} ${escapeHtml(field)} - ${shortDate(item.date)}</span></li>`;
}

function contentBenchmark(scopePlatforms, end, field) {
  const start = shiftIsoDate(end, -13);
  const items = scopedContent(scopePlatforms, start, end).filter((item) => contentMetricValue(item, field) > 0);
  if (!items.length) return null;
  const avg = items.reduce((sum, item) => sum + contentMetricValue(item, field), 0) / items.length;
  return { avg, count: items.length };
}

function paidImpactForClick(scopePlatforms, metricKey, period, prevWindow) {
  const lines = [];
  const limits = [];
  let impact = 'none';

  if (scopePlatforms.includes('facebook') && (metricKey === 'views' || metricKey === 'reach')) {
    const paid = scopedFieldTotal(['facebook'], period.start, period.end, 'paidViews');
    const priorPaid = scopedFieldTotal(['facebook'], prevWindow.start, prevWindow.end, 'paidViews');
    if (paid > 0 || priorPaid > 0) {
      const direction = deltaWords(paid, priorPaid);
      if (paid > priorPaid * 1.15 && paid > 0) impact = 'up';
      if (paid < priorPaid * 0.85 && priorPaid > 0) impact = 'down';
      const note = metricKey === 'views'
        ? 'Facebook dashboard views are organic, so paid media is background context.'
        : 'Facebook reach can be affected by paid distribution.';
      lines.push(`Facebook paid media views: ${fmtFull(paid)} (${direction || 'no prior paid change'}). ${note}`);
    }
  }

  if (scopePlatforms.includes('youtube') && (metricKey === 'views' || metricKey === 'watchTime')) {
    const field = metricKey === 'watchTime' ? 'adWatchTime' : 'adViews';
    const adValue = scopedFieldTotal(['youtube'], period.start, period.end, field);
    const priorAd = scopedFieldTotal(['youtube'], prevWindow.start, prevWindow.end, field);
    if (adValue > 0 || priorAd > 0) {
      const direction = deltaWords(adValue, priorAd);
      if (adValue > priorAd * 1.15 && adValue > 0) impact = 'up';
      if (adValue < priorAd * 0.85 && priorAd > 0) impact = 'down';
      const formatted = metricKey === 'watchTime' ? fmtMetricVal('watchTime', adValue) : fmtFull(adValue);
      const youtubeValue = scopedFieldTotal(['youtube'], period.start, period.end, metricKey);
      const share = youtubeValue > 0 ? `; equivalent to about ${Math.round(adValue / youtubeValue * 100)}% of YouTube ${METRIC_NOUN[metricKey]}` : '';
      lines.push(`YouTube ad traffic: ${formatted} (${direction || 'no prior ad change'})${share}. Dashboard YouTube views are separate from ad traffic.`);
    }
  }

  if (scopePlatforms.includes('instagram') && (metricKey === 'views' || metricKey === 'reach')) {
    limits.push('Instagram includes paid/promoted distribution, but this data does not include a day-level organic vs paid split.');
  }

  return { lines, limits, impact };
}

function insightSection(title, bodyHtml) {
  if (!bodyHtml) return '';
  return `<div class="insight-section"><div class="insight-section-title">${escapeHtml(title)}</div><div class="insight-section-body">${bodyHtml}</div></div>`;
}

function showInsight(platform, metricKey, idx) {
  const panel = $('#insightPanel');
  const period = state.periods[idx];
  const scope = platform === 'total' ? 'All platforms' : nameOf(platform);
  const metric = METRIC_NOUN[metricKey] || metricKey;
  $('#insightTitle').textContent = period ? `${scope} ${metric} - ${period.label}` : 'Data insights';
  $('#insightBody').innerHTML = buildInsightV2(platform, metricKey, idx);
  panel.hidden = false;
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Build the insight HTML for one (platform|'total', metric, period).
function buildInsight(platform, metricKey, idx) {
  const period = state.periods[idx];
  if (!period) return '';
  const noun = GRAN_NOUN[state.granularity];
  const scopePlatforms = platform === 'total' ? platforms().filter((p) => supports(p, metricKey)) : [platform];
  const valAt = (i) => scopePlatforms.reduce((s, p) => s + ((state.series[p] && state.series[p][i]) ? (state.series[p][i][metricKey] || 0) : 0), 0);
  const vals = state.periods.map((_, i) => valAt(i));
  const value = vals[idx];
  const others = vals.filter((_, i) => i !== idx);
  const avg = others.length ? others.reduce((a, b) => a + b, 0) / others.length : 0;
  const factor = avg > 0 ? value / avg : null;
  const prev = idx > 0 ? vals[idx - 1] : null;
  const wow = (prev != null && prev !== 0) ? (value - prev) / prev : null;
  const isPeak = value > 0 && value === Math.max(...vals);
  const movement = movementText(wow, factor);

  const scopeLabel = platform === 'total' ? 'All platforms' : nameOf(platform);
  const metricName = METRIC_NOUN[metricKey];

  // Spike characterization vs the rest of the visible periods.
  let badge = '', badgeCls = '';
  if (factor != null) {
    if (factor >= 1.4) { badge = `▲ ${factor.toFixed(1)}× the ${others.length}-${noun} average`; badgeCls = 'hot'; }
    else if (factor <= 0.7) { badge = `▼ ${factor.toFixed(1)}× the average`; badgeCls = 'low'; }
    else { badge = `≈ around the ${others.length}-${noun} average`; badgeCls = 'mid'; }
  }

  let html = `<p class="insight-headline"><strong>${scopeLabel}</strong> · ${metricName} · ${escapeHtml(period.label)}</p>`;
  html += `<div class="insight-stat"><span class="insight-value">${fmtMetricVal(metricKey, value)}</span>`;
  if (badge) html += ` <span class="spike-badge ${badgeCls}">${badge}</span>`;
  html += `</div>`;
  const wowBits = [];
  if (wow != null) wowBits.push(`${wow >= 0 ? '▲' : '▼'} ${(Math.abs(wow) * 100).toFixed(0)}% vs prior ${noun}`);
  if (isPeak) wowBits.push('highest in the current view');
  html += `<p class="insight-sub">This point reads as a <strong>${escapeHtml(movement)}</strong>${wow != null ? ` (${wow >= 0 ? 'up' : 'down'} ${(Math.abs(wow) * 100).toFixed(0)}% vs prior ${noun})` : ''}.</p>`;
  html += adContextHtml(scopePlatforms, metricKey, idx, movement);
  if (wowBits.length) html += `<div class="insight-wow">${wowBits.join(' · ')}</div>`;

  // Posts in this window, ranked by the relevant field.
  const field = CONTENT_FIELD[metricKey];
  const sortField = field || 'views';
  const cont = (state.data.content || [])
    .filter((c) => (platform === 'total' || c.platform === platform) && c.date >= period.start && c.date <= period.end)
    .sort((a, b) => (b[sortField] || 0) - (a[sortField] || 0));
  const top = cont.slice(0, 3);

  // Is per-post attribution exact? IG/FB views & reach are bucketed by post (sum matches);
  // YouTube views/watch are channel-wide day totals, so they won't match the posts' lifetime sums.
  let shareValid = false;
  if (field) {
    const sum = cont.reduce((s, c) => s + (c[field] || 0), 0);
    shareValid = value > 0 && sum > 0 && sum / value >= 0.8 && sum / value <= 1.25;
  } else if (metricKey === 'posts') {
    shareValid = true;
  }

  if (top.length) {
    const heading = metricKey === 'posts'
      ? `${cont.length} post${cont.length === 1 ? '' : 's'} published this ${noun} — top by views:`
      : shareValid ? `What drove it — top posts published this ${noun}:` : `Posts published this ${noun}:`;
    html += `<p class="insight-sub">${heading}</p><ul class="insight-list">`;
    for (const c of top) {
      const lbl = c.title && c.title.trim() ? c.title : `${capWord(c.platform)} post`;
      const link = c.url && c.url !== '#'
        ? `<a class="content-link" href="${escapeHtml(c.url)}" target="_blank" rel="noopener">${escapeHtml(lbl)}</a>`
        : escapeHtml(lbl);
      const mv = c[sortField];
      const share = (shareValid && field && value > 0 && mv != null) ? ` · ${Math.round(mv / value * 100)}% of ${metricName}` : '';
      const plat = platform === 'total' ? `${nameOf(c.platform)} · ` : '';
      html += `<li><span class="type-tag">${escapeHtml(c.type || '—')}</span> ${link}<span class="ins-meta">${plat}${fmt(mv)} ${sortField}${share} · ${c.date}</span></li>`;
    }
    html += `</ul>`;
    const types = [...new Set(top.map((c) => c.type).filter(Boolean))];
    if (top.length >= 2 && types.length === 1) {
      html += `<div class="insight-pattern">📌 Every top post this ${noun} was a <strong>${escapeHtml(types[0])}</strong> — that format is working for ${escapeHtml(scopeLabel)}.</div>`;
    }
  }

  // Honest caveats where the data can't pin a single cause.
  const caveats = [];
  if (!top.length && value > 0) caveats.push(`No posts were published this ${noun}; the ${metricName} came from continued activity on earlier content.`);
  if (!top.length && value === 0) caveats.push(`No posts and no recorded ${metricName} this ${noun}.`);
  const ytInScope = platform === 'youtube' || (platform === 'total' && scopePlatforms.includes('youtube'));
  if (ytInScope && (metricKey === 'views' || metricKey === 'watchTime') && !shareValid) {
    caveats.push(`YouTube ${metricName} reflects channel-wide viewing during this ${noun} (across all videos, old and new), so it can't be tied to a single upload. The posts above are what was published in the window.`);
  }
  if (caveats.length) html += `<p class="insight-caveat">${caveats.map(escapeHtml).join('<br>')}</p>`;

  return html;
}

// New click insight: explain what happened on/around the selected date instead
// of only restating the clicked metric.
function buildInsightV2(platform, metricKey, idx) {
  const period = state.periods[idx];
  if (!period) return '';

  const noun = GRAN_NOUN[state.granularity];
  const scopePlatforms = platform === 'total' ? platforms().filter((p) => supports(p, metricKey)) : [platform];
  const valAt = (i) => scopePlatforms.reduce((sum, p) => sum + ((state.series[p] && state.series[p][i]) ? (state.series[p][i][metricKey] || 0) : 0), 0);
  const vals = state.periods.map((_, i) => valAt(i));
  const value = vals[idx];
  const others = vals.filter((_, i) => i !== idx);
  const avg = others.length ? others.reduce((sum, v) => sum + v, 0) / others.length : 0;
  const factor = avg > 0 ? value / avg : null;
  const prevWindow = priorWindow(period);
  const priorValue = scopedFieldTotal(scopePlatforms, prevWindow.start, prevWindow.end, metricKey);
  const windowDelta = priorValue ? (value - priorValue) / priorValue : null;
  const isPeak = value > 0 && value === Math.max(...vals);
  const scopeLabel = platform === 'total' ? 'All platforms' : nameOf(platform);
  const metricName = METRIC_NOUN[metricKey] || metricKey;

  let badge = '', badgeCls = '';
  if (factor != null) {
    if (factor >= 1.4) { badge = `Up ${factor.toFixed(1)}x vs chart average`; badgeCls = 'hot'; }
    else if (factor <= 0.7) { badge = `Down ${factor.toFixed(1)}x vs chart average`; badgeCls = 'low'; }
    else { badge = 'Near chart average'; badgeCls = 'mid'; }
  }

  let html = `<p class="insight-headline"><strong>${escapeHtml(scopeLabel)}</strong> - ${escapeHtml(metricName)} - ${escapeHtml(period.label)}</p>`;
  html += `<div class="insight-stat"><span class="insight-value">${fmtMetricVal(metricKey, value)}</span>`;
  if (badge) html += ` <span class="spike-badge ${badgeCls}">${escapeHtml(badge)}</span>`;
  html += '</div>';

  const movementLines = [];
  if (windowDelta != null) {
    movementLines.push(`${windowDelta >= 0 ? 'Up' : 'Down'} ${(Math.abs(windowDelta) * 100).toFixed(0)}% vs ${prevWindow.label} (${fmtMetricVal(metricKey, priorValue)}).`);
  } else {
    movementLines.push(`No comparable ${metricName} in ${prevWindow.label}.`);
  }
  if (factor != null) {
    movementLines.push(factor >= 1.15 || factor <= 0.85
      ? `${factor.toFixed(1)}x the visible ${noun} average.`
      : `About even with the visible ${noun} average.`);
  }
  if (isPeak) movementLines.push('Highest point in the current chart view.');
  html += insightSection('Movement', `<ul class="insight-driver-list">${movementLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`);

  const field = CONTENT_FIELD[metricKey];
  const sortField = field || 'views';
  const currentContent = scopedContent(scopePlatforms, period.start, period.end)
    .sort((a, b) => contentMetricValue(b, sortField) - contentMetricValue(a, sortField));
  const priorContent = scopedContent(scopePlatforms, prevWindow.start, prevWindow.end)
    .sort((a, b) => contentMetricValue(b, sortField) - contentMetricValue(a, sortField));
  const currentTop = currentContent.slice(0, 3);
  const priorTop = priorContent.slice(0, state.granularity === 'daily' ? 2 : 1);

  let shareValid = false;
  if (field) {
    const contentSum = currentContent.reduce((sum, item) => sum + contentMetricValue(item, field), 0);
    shareValid = value > 0 && contentSum > 0 && contentSum / value >= 0.8 && contentSum / value <= 1.25;
  } else if (metricKey === 'posts') {
    shareValid = true;
  }

  const contributorLines = [];
  for (const item of currentTop) contributorLines.push(contentDriverLine(item, sortField, platform, state.granularity === 'daily' ? 'Same day' : 'This period'));
  for (const item of priorTop) contributorLines.push(contentDriverLine(item, sortField, platform, state.granularity === 'daily' ? 'Prior day' : 'Prior period'));

  let patternHtml = '';
  const benchmark = contentBenchmark(scopePlatforms, period.end, sortField);
  const topItem = currentTop[0];
  if (topItem && benchmark && benchmark.avg > 0) {
    const multiple = contentMetricValue(topItem, sortField) / benchmark.avg;
    if (multiple >= 2) {
      patternHtml = `<div class="insight-pattern"><strong>Outlier content:</strong> ${escapeHtml(topItem.title || `${nameOf(topItem.platform)} post`)} was ${multiple.toFixed(1)}x the recent post average for ${escapeHtml(sortField)}.</div>`;
    }
  }

  if (contributorLines.length) {
    const intro = shareValid && metricKey !== 'posts'
      ? 'Post-level totals line up closely with this point, so these are likely content drivers.'
      : `These are the posts/videos published on the clicked ${noun} or immediately before it.`;
    html += insightSection('Likely contributors', `<p class="insight-mini">${escapeHtml(intro)}</p><ul class="insight-driver-list">${contributorLines.join('')}</ul>${patternHtml}`);
  } else {
    html += insightSection('Likely contributors', `<p class="insight-mini">No posts/videos were published on the clicked ${noun} or prior ${noun}. Movement likely came from older content, distribution, or paid context if present.</p>`);
  }

  const paid = paidImpactForClick(scopePlatforms, metricKey, period, prevWindow);
  if (paid.lines.length) {
    html += insightSection('Paid impact', `<ul class="insight-driver-list">${paid.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`);
  }

  const caveats = [...paid.limits];
  const ytInScope = platform === 'youtube' || (platform === 'total' && scopePlatforms.includes('youtube'));
  if (ytInScope && (metricKey === 'views' || metricKey === 'watchTime') && !shareValid) {
    const verb = metricKey === 'views' ? 'reflect' : 'reflects';
    caveats.push(`YouTube ${metricName} ${verb} viewing across old and new videos, so new uploads are not the only possible driver.`);
  }
  if (caveats.length) html += `<p class="insight-caveat">${caveats.map(escapeHtml).join('<br>')}</p>`;

  let takeaway;
  if (paid.impact === 'up' && (windowDelta == null || windowDelta >= 0)) takeaway = 'Paid/ad activity increased in the same window, so treat paid distribution as a likely contributor to the lift.';
  else if (paid.impact === 'down' && (windowDelta == null || windowDelta < 0)) takeaway = 'Paid/ad activity dropped in the same window, so it likely contributed to the decline.';
  else if (shareValid && currentTop.length && metricKey !== 'posts') takeaway = 'This looks content-led. Start by reviewing the same-day top post and the hook/format behind it.';
  else if (currentTop.length || priorTop.length) takeaway = 'Review the posts above first; the data shows nearby content activity, but attribution is directional rather than exact.';
  else takeaway = 'No nearby new content explains this point. Check older content, distribution, and any paid activity outside the connected organic sources.';
  html += `<div class="insight-takeaway"><strong>Takeaway:</strong> ${escapeHtml(takeaway)}</div>`;

  return html;
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------
function csv(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function exportCsv() {
  if (!state.data) return;
  const { client } = state.data;
  const noun = GRAN_NOUN[state.granularity];
  const ps = platforms();
  const wow = (c, p) => (c != null && p ? (((c - p) / p) * 100).toFixed(1) + '%' : 'n/a');
  const lines = [];
  lines.push(`${csv(client.name)} — Social Report`);
  lines.push(`Range,${csv(state.rangeStart + ' to ' + state.rangeEnd)},vs prior,${csv(state.priorRange.start + ' to ' + state.priorRange.end)},Chart grouping,${noun}`);
  lines.push('');
  lines.push(`Platform,Posts,Posts delta,Views,Views delta,New followers,New followers delta,Total followers,Reach,Reach delta,Watch time (min),Watch delta,Source`);
  for (const p of ps) {
    const m = state.data.metrics[p];
    const c = (k) => platformAt(p, k, 0), pr = (k) => platformAt(p, k, 1);
    const wt = m.hasWatchTime ? c('watchTime') : '';
    const wtw = m.hasWatchTime ? wow(c('watchTime'), pr('watchTime')) : '';
    lines.push([p, c('posts'), wow(c('posts'), pr('posts')), c('views'), wow(c('views'), pr('views')),
      c('newFollowers'), wow(c('newFollowers'), pr('newFollowers')), c('totalFollowers'), c('reach'), wow(c('reach'), pr('reach')), wt, wtw, m.source].join(','));
  }
  const t = (k, i) => totalAt(k, i);
  lines.push(['TOTAL', t('posts', 0), wow(t('posts', 0), t('posts', 1)), t('views', 0), wow(t('views', 0), t('views', 1)),
    t('newFollowers', 0), wow(t('newFollowers', 0), t('newFollowers', 1)), t('totalFollowers', 0), t('reach', 0), wow(t('reach', 0), t('reach', 1)), t('watchTime', 0), wow(t('watchTime', 0), t('watchTime', 1)), ''].join(','));

  lines.push('');
  lines.push(`History (per ${noun})`);
  lines.push('Platform,Period,Posts,Views,New followers,Total followers,Reach,Watch time (min)');
  for (const p of ps) {
    state.series[p].forEach((x) => {
      lines.push([p, csv(x.label), x.posts, x.views, x.newFollowers == null ? '' : x.newFollowers, x.totalFollowers == null ? '' : x.totalFollowers, x.reach, x.watchTime == null ? '' : x.watchTime].join(','));
    });
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${client.id}-report-${state.rangeStart}_to_${state.rangeEnd}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

setTheme(savedTheme());
init();
