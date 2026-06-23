'use strict';

/**
 * Connector registry.
 *
 * Every connector exports the same async function:
 *
 *   fetchMetrics({ clientId, account, days, now }) -> normalized payload
 *
 * The normalized payload shape is documented in demoData.js (the reference
 * implementation). When a connector has no real credentials configured, it
 * returns demo data so the dashboard always renders.
 */

const instagram = require('./instagram');
const facebook = require('./facebook');
const tiktok = require('./tiktok');
const youtube = require('./youtube');

const CONNECTORS = { instagram, facebook, tiktok, youtube };

const PLATFORMS = Object.keys(CONNECTORS);

async function fetchMetrics(platform, ctx) {
  const connector = CONNECTORS[platform];
  if (!connector) {
    throw new Error(`Unknown platform: ${platform}`);
  }
  return connector.fetchMetrics(ctx);
}

module.exports = { PLATFORMS, fetchMetrics };
