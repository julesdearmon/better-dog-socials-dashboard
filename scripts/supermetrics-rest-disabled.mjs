#!/usr/bin/env node
console.error('The standalone Supermetrics REST Query API is disabled for this project.');
console.error('This Supermetrics license supports the ChatGPT/Codex connector, not /enterprise/v2 server-to-server calls.');
console.error('Use the daily Codex Supermetrics refresh automation, then let GitHub Actions deploy the committed public files.');
process.exit(1);
