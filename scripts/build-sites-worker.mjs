import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const publicDir = path.join(repoRoot, 'public');
const distDir = path.join(repoRoot, 'dist');
const serverDir = path.join(distDir, 'server');
const sourcePath = path.join(repoRoot, 'scripts', 'sites-worker-source.mjs');

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function routeFor(filePath) {
  const rel = path.relative(publicDir, filePath).replaceAll(path.sep, '/');
  return '/' + rel;
}

function contentType(filePath) {
  return mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

const files = await walk(publicDir);
const assets = [];
for (const file of files) {
  assets.push([
    routeFor(file),
    { type: contentType(file), body: (await fs.readFile(file)).toString('base64') },
  ]);
}

await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(serverDir, { recursive: true });

const source = await fs.readFile(sourcePath, 'utf8');
await fs.writeFile(
  path.join(serverDir, 'index.js'),
  source.replace('__BD_DASHBOARD_ASSETS__', JSON.stringify(assets)),
);

console.log('Built ChatGPT Sites worker from public dashboard assets.');
