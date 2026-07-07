import { next } from '@vercel/functions';

declare const process: { env: Record<string, string | undefined> };

const COOKIE_NAME = 'bd_social_dashboard_auth';
const COOKIE_DAYS = 7;

export const config = {
  matcher: '/((?!_vercel/).*)'
};

function envPasscode() {
  return process.env.DASHBOARD_PASSCODE || process.env.DASHBOARD_PASSWORD || '';
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char] || char));
}

function parseCookie(header: string, name: string) {
  return header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(name + '='))
    ?.slice(name.length + 1) || '';
}

function safeNextPath(value: FormDataEntryValue | string | null) {
  const path = String(value || '/');
  if (!path.startsWith('/') || path.startsWith('//')) return '/';
  if (path.startsWith('/_dashboard-login')) return '/';
  return path;
}

function sameValue(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function authToken(passcode: string) {
  return sha256('better-dog-social-dashboard:' + passcode);
}

function loginPage(nextPath: string, error = false, missingPasscode = false) {
  const message = missingPasscode
    ? '<p class="error">Dashboard passcode is not configured yet.</p>'
    : error
      ? '<p class="error">That code is not right. Try again.</p>'
      : '';

  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Better Dog Social Dashboard</title>
  <style>
    :root { color-scheme: light; --ink: #222322; --muted: #696a62; --brand: #f97316; --line: #ddd8cc; --paper: #fbfaf6; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: #f4f1e9; }
    main { width: min(420px, calc(100vw - 32px)); padding: 32px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); box-shadow: 0 20px 60px rgba(34, 35, 34, 0.12); }
    img { display: block; max-width: 180px; max-height: 56px; margin-bottom: 24px; object-fit: contain; }
    h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; letter-spacing: 0; }
    p { margin: 0 0 20px; color: var(--muted); line-height: 1.45; }
    label { display: block; margin-bottom: 8px; font-weight: 700; font-size: 14px; }
    input { width: 100%; height: 46px; padding: 0 12px; border: 1px solid var(--line); border-radius: 6px; font: inherit; background: #fff; }
    button { width: 100%; height: 46px; margin-top: 14px; border: 0; border-radius: 6px; background: var(--ink); color: #fff; font: inherit; font-weight: 800; cursor: pointer; }
    button:hover { background: #000; }
    .error { margin: 0 0 14px; color: #b42318; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <img src="/logo.png" alt="Better Dog Supplements">
    <h1>Social Dashboard</h1>
    <p>Enter the access code to continue.</p>
    ${message}
    <form method="post" action="/_dashboard-login">
      <input type="hidden" name="next" value="${escapeHtml(nextPath)}">
      <label for="passcode">Access code</label>
      <input id="passcode" name="passcode" type="password" autocomplete="current-password" autofocus required>
      <button type="submit">Enter</button>
    </form>
  </main>
</body>
</html>`, {
    status: missingPasscode ? 503 : 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function setAuthCookie(response: Response, token: string) {
  const maxAge = COOKIE_DAYS * 24 * 60 * 60;
  response.headers.append(
    'set-cookie',
    `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`
  );
}

function clearAuthCookie(response: Response) {
  response.headers.append(
    'set-cookie',
    `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
  );
}

function redirectTo(url: URL) {
  return new Response(null, {
    status: 303,
    headers: {
      location: url.toString()
    }
  });
}

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const passcode = envPasscode();

  if (url.pathname === '/logo.png' || url.pathname === '/favicon.ico') {
    return next();
  }

  if (!passcode) {
    return loginPage(url.pathname + url.search, false, true);
  }

  if (url.pathname === '/_dashboard-logout') {
    const response = redirectTo(new URL('/', request.url));
    clearAuthCookie(response);
    return response;
  }

  if (url.pathname === '/_dashboard-login' && request.method === 'POST') {
    const form = await request.formData();
    const entered = String(form.get('passcode') || '');
    const redirectPath = safeNextPath(form.get('next'));
    const expected = await authToken(passcode);

    if (sameValue(await authToken(entered), expected)) {
      const response = redirectTo(new URL(redirectPath, request.url));
      setAuthCookie(response, expected);
      return response;
    }

    return loginPage(redirectPath, true);
  }

  const cookie = parseCookie(request.headers.get('cookie') || '', COOKIE_NAME);
  if (sameValue(cookie, await authToken(passcode))) {
    return next();
  }

  return loginPage(url.pathname + url.search);
}
