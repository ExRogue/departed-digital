const crypto = require('node:crypto');

const SESSION_COOKIE = 'departed_digital_admin_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

function getCookieMap(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((accumulator, part) => {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey) {
      return accumulator;
    }

    accumulator[rawKey] = decodeURIComponent(rawValue.join('=') || '');
    return accumulator;
  }, {});
}

function signSessionPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function buildSessionToken(username, secret, expiresAt) {
  const payload = JSON.stringify({ username, expiresAt });
  const encodedPayload = Buffer.from(payload, 'utf8').toString('base64url');
  const signature = signSessionPayload(encodedPayload, secret);
  return encodedPayload + '.' + signature;
}

function verifySessionToken(token, secret) {
  if (!token || !secret) {
    return null;
  }

  const [encodedPayload, signature] = String(token).split('.');

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signSessionPayload(encodedPayload, secret);

  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));

    if (!payload || !payload.username || !payload.expiresAt) {
      return null;
    }

    if (Number(payload.expiresAt) <= Date.now()) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

function getSessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_ACCESS_TOKEN || '';
}

function getConfiguredAdminCredentials() {
  return {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || ''
  };
}

function createAdminSession(username) {
  const secret = getSessionSecret();

  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET is not configured yet.');
  }

  const expiresAt = Date.now() + (SESSION_MAX_AGE_SECONDS * 1000);
  return {
    token: buildSessionToken(username, secret, expiresAt),
    expiresAt
  };
}

function getAdminSession(req) {
  const cookies = getCookieMap(req);
  const secret = getSessionSecret();
  const token = cookies[SESSION_COOKIE];

  if (!secret || !token) {
    return null;
  }

  return verifySessionToken(token, secret);
}

function buildSessionCookie(token) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`
  ].join('; ');
}

function buildLogoutCookie() {
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=0'
  ].join('; ');
}

function requireAdminAccess(req) {
  const session = getAdminSession(req);

  if (session) {
    return {
      ok: true,
      session
    };
  }

  const configuredKey = process.env.ADMIN_ACCESS_TOKEN;
  const providedKey = req.headers['x-admin-key'] || req.headers['X-Admin-Key'];

  if (!configuredKey && !getConfiguredAdminCredentials().password) {
    return {
      ok: false,
      statusCode: 503,
      message: 'Admin authentication is not configured yet.'
    };
  }

  if (configuredKey && providedKey && safeEqual(providedKey, configuredKey)) {
    return { ok: true, session: { username: getConfiguredAdminCredentials().username } };
  }

  return {
    ok: false,
    statusCode: 401,
    message: 'Admin login required.'
  };
}

function verifyAdminCredentials(username, password) {
  const configured = getConfiguredAdminCredentials();

  if (!configured.password) {
    return {
      ok: false,
      statusCode: 503,
      message: 'ADMIN_PASSWORD is not configured yet.'
    };
  }

  const usernameMatches = safeEqual(username || '', configured.username);
  const passwordMatches = safeEqual(password || '', configured.password);

  if (!usernameMatches || !passwordMatches) {
    return {
      ok: false,
      statusCode: 401,
      message: 'Username or password is incorrect.'
    };
  }

  return {
    ok: true,
    username: configured.username
  };
}

module.exports = {
  SESSION_COOKIE,
  buildLogoutCookie,
  buildSessionCookie,
  createAdminSession,
  getAdminSession,
  getConfiguredAdminCredentials,
  requireAdminAccess,
  safeEqual,
  verifyAdminCredentials
};
