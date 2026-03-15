const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { get, put } = require('@vercel/blob');
const { hasDatabaseConnection, query } = require('./db');

const {
  ADMIN_ROLES,
  ADMIN_ROLE_PERMISSIONS
} = require('./config');

const SESSION_COOKIE = 'departed_digital_admin_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const ADMIN_USERS_FILE = 'meta/admin-users.json';
const SESSION_CACHE_TTL_MS = 45 * 1000;
const USER_CACHE_TTL_MS = 60 * 1000;
const USER_LIST_CACHE_TTL_MS = 60 * 1000;
const LOGIN_DEFAULTS_CACHE_TTL_MS = 60 * 1000;

const adminSessionCache = new Map();
const adminUserCache = new Map();
let adminUserListCache = { expiresAt: 0, users: null };
let loginDefaultsCache = { expiresAt: 0, value: null };
let databaseSeedEnsureState = { expiresAt: 0, username: '' };

const DATA_ROOT = process.env.DEPARTED_DATA_ROOT
  ? path.resolve(process.env.DEPARTED_DATA_ROOT)
  : (process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN
    ? '/tmp/departed-digital-data'
    : path.join(process.cwd(), 'data'));

function trimTo(value, maxLength = 4000) {
  return String(value || '').trim().slice(0, maxLength);
}

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

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function getCachedEntry(cache, key) {
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function setCachedEntry(cache, key, value, ttlMs) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

function clearSessionCache(token) {
  if (!token) {
    adminSessionCache.clear();
    return;
  }

  adminSessionCache.delete(hashSessionToken(token));
}

function clearUserCaches() {
  adminUserCache.clear();
  adminUserListCache = { expiresAt: 0, users: null };
  loginDefaultsCache = { expiresAt: 0, value: null };
  databaseSeedEnsureState = { expiresAt: 0, username: '' };
  adminSessionCache.clear();
}

function buildSessionToken(user, secret, expiresAt) {
  const payload = JSON.stringify({
    userId: user.id || '',
    username: user.username,
    role: user.role || 'founder_admin',
    name: user.name || user.username,
    expiresAt
  });
  const encodedPayload = Buffer.from(payload, 'utf8').toString('base64url');
  const signature = signSessionPayload(encodedPayload, secret);
  return encodedPayload + '.' + signature;
}

function buildDatabaseSessionToken(sessionId) {
  return `${sessionId}.${crypto.randomBytes(32).toString('hex')}`;
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

function isDatabaseSessionToken(token) {
  const [sessionId, secret] = String(token || '').split('.');
  return isUuid(sessionId) && Boolean(secret);
}

function normalizeRole(role) {
  return ADMIN_ROLES.includes(role) ? role : 'founder_admin';
}

function getRolePermissions(role) {
  return ADMIN_ROLE_PERMISSIONS[normalizeRole(role)] || [];
}

function hasPermission(role, permission) {
  if (!permission) {
    return true;
  }

  return getRolePermissions(role).includes(permission);
}

function createPasswordHash(password, salt) {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password || ''), actualSalt, 64).toString('hex');
  return `scrypt:${actualSalt}:${derived}`;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function stableUuid(seed) {
  const hex = crypto.createHash('sha256').update(String(seed || '')).digest('hex').slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32)
  ].join('-');
}

function verifyPasswordHash(password, passwordHash) {
  const [scheme, salt, expectedHash] = String(passwordHash || '').split(':');

  if (scheme !== 'scrypt' || !salt || !expectedHash) {
    return false;
  }

  const actualHash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return safeEqual(actualHash, expectedHash);
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallback;
    }

    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

async function readBlobJson(blobPath, fallback) {
  let response;

  try {
    response = await get(blobPath, { access: 'private' });
  } catch (error) {
    const isMissingBlob = error
      && (error.status === 404
        || error.code === 'not_found'
        || error.name === 'BlobNotFoundError'
        || /not found/i.test(String(error.message || '')));

    if (isMissingBlob) {
      return fallback;
    }

    throw error;
  }

  if (!response) {
    return fallback;
  }

  const raw = await new Response(response.stream).text();
  return JSON.parse(raw);
}

async function writeBlobJson(blobPath, value) {
  await put(blobPath, JSON.stringify(value, null, 2), {
    access: 'private',
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: 'application/json; charset=utf-8'
  });
}

async function readUserStore() {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return readBlobJson(ADMIN_USERS_FILE, []);
  }

  return readJsonFile(path.join(DATA_ROOT, ADMIN_USERS_FILE), []);
}

async function writeUserStore(users) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return writeBlobJson(ADMIN_USERS_FILE, users);
  }

  return writeJsonFile(path.join(DATA_ROOT, ADMIN_USERS_FILE), users);
}

function mapDatabaseUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: trimTo(row.id, 120),
    name: trimTo(row.display_name, 160) || trimTo(row.username, 120),
    username: trimTo(row.username, 120).toLowerCase(),
    role: normalizeRole(row.role),
    status: trimTo(row.status, 40) === 'disabled' ? 'disabled' : 'active',
    passwordHash: trimTo(row.password_hash, 500),
    createdAt: trimTo(row.created_at, 80),
    updatedAt: trimTo(row.updated_at, 80)
  };
}

async function readDatabaseUsers() {
  const result = await query(`
    select
      id,
      username,
      display_name,
      role,
      status,
      password_hash,
      created_at::text as created_at,
      updated_at::text as updated_at
    from app_users
    order by created_at asc
  `);

  return result.rows.map(mapDatabaseUser).filter(Boolean);
}

async function readDatabaseUserByIdentity(identity) {
  const normalizedIdentity = trimTo(identity, 120).toLowerCase();

  if (!normalizedIdentity) {
    return null;
  }

  const cacheKey = normalizedIdentity;
  const cached = getCachedEntry(adminUserCache, cacheKey);

  if (cached) {
    return cached;
  }

  const result = await query(`
    select
      id,
      username,
      display_name,
      role,
      status,
      password_hash,
      created_at::text as created_at,
      updated_at::text as updated_at
    from app_users
    where id::text = $1
      or lower(username) = $2
    limit 1
  `, [trimTo(identity, 120), normalizedIdentity]);

  const user = mapDatabaseUser(result.rows[0]);

  if (user) {
    setCachedEntry(adminUserCache, cacheKey, user, USER_CACHE_TTL_MS);
    setCachedEntry(adminUserCache, trimTo(user.id, 120), user, USER_CACHE_TTL_MS);
    setCachedEntry(adminUserCache, user.username, user, USER_CACHE_TTL_MS);
  }

  return user;
}

async function readDatabaseFirstActiveUser() {
  const result = await query(`
    select
      id,
      username,
      display_name,
      role,
      status,
      password_hash,
      created_at::text as created_at,
      updated_at::text as updated_at
    from app_users
    where status = 'active'
    order by created_at asc
    limit 1
  `);

  return mapDatabaseUser(result.rows[0]);
}

async function writeDatabaseUser(user) {
  const userId = isUuid(user.id) ? user.id : stableUuid(`user:${user.username}`);

  await query(`
    insert into app_users (
      id,
      username,
      display_name,
      role,
      status,
      password_hash,
      created_at,
      updated_at
    ) values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)
    on conflict (id) do update set
      username = excluded.username,
      display_name = excluded.display_name,
      role = excluded.role,
      status = excluded.status,
      password_hash = excluded.password_hash,
      updated_at = excluded.updated_at
  `, [
    userId,
    user.username,
    user.name,
    user.role,
    user.status,
    user.passwordHash,
    user.createdAt,
    user.updatedAt
  ]);

  clearUserCaches();
}

async function createDatabaseSession(user) {
  const sessionId = crypto.randomUUID();
  const token = buildDatabaseSessionToken(sessionId);
  const expiresAt = new Date(Date.now() + (SESSION_MAX_AGE_SECONDS * 1000)).toISOString();

  await query(`
    insert into admin_sessions (
      id,
      user_id,
      session_token_hash,
      expires_at
    ) values ($1::uuid, $2::uuid, $3, $4::timestamptz)
  `, [
    sessionId,
    user.id,
    hashSessionToken(token),
    expiresAt
  ]);

  const session = {
    token,
    expiresAt
  };

  setCachedEntry(adminSessionCache, hashSessionToken(token), {
    sessionId,
    userId: trimTo(user.id, 120),
    username: trimTo(user.username, 120),
    role: normalizeRole(user.role),
    name: trimTo(user.name, 160) || trimTo(user.username, 120),
    expiresAt: new Date(expiresAt).getTime()
  }, SESSION_CACHE_TTL_MS);

  return session;
}

async function readDatabaseSession(token) {
  const [sessionId] = String(token || '').split('.');

  if (!isDatabaseSessionToken(token)) {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const cached = getCachedEntry(adminSessionCache, tokenHash);

  if (cached) {
    return cached;
  }

  const result = await query(`
    select
      s.id::text as session_id,
      s.expires_at::text as expires_at,
      u.id::text as user_id,
      u.username,
      u.display_name,
      u.role,
      u.status
    from admin_sessions s
    inner join app_users u on u.id = s.user_id
    where s.id = $1::uuid
      and s.session_token_hash = $2
      and s.invalidated_at is null
      and s.expires_at > now()
    limit 1
  `, [sessionId, hashSessionToken(token)]);

  const row = result.rows[0];

  if (!row || row.status !== 'active') {
    return null;
  }

  const session = {
    sessionId: trimTo(row.session_id, 120),
    userId: trimTo(row.user_id, 120),
    username: trimTo(row.username, 120),
    role: normalizeRole(row.role),
    name: trimTo(row.display_name, 160) || trimTo(row.username, 120),
    expiresAt: new Date(row.expires_at).getTime()
  };

  setCachedEntry(adminSessionCache, tokenHash, session, SESSION_CACHE_TTL_MS);
  return session;
}

async function invalidateDatabaseSession(token) {
  const [sessionId] = String(token || '').split('.');

  if (!isDatabaseSessionToken(token)) {
    return false;
  }

  const result = await query(`
    update admin_sessions
    set invalidated_at = now()
    where id = $1::uuid
      and session_token_hash = $2
      and invalidated_at is null
  `, [sessionId, hashSessionToken(token)]);

  const invalidated = result.rowCount > 0;

  if (invalidated) {
    clearSessionCache(token);
  }

  return invalidated;
}

function getConfiguredAdminCredentials() {
  return {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || ''
  };
}

function getDefaultSeedUser() {
  const configured = getConfiguredAdminCredentials();

  if (!configured.password) {
    return null;
  }

  return {
    id: 'seed-founder-admin',
    name: process.env.ADMIN_NAME || 'Founder Admin',
    username: configured.username,
    role: 'founder_admin',
    status: 'active',
    passwordHash: createPasswordHash(configured.password),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizeStoredUser(input, timestamp) {
  const now = timestamp || new Date().toISOString();
  const username = trimTo(input && input.username, 120).toLowerCase();

  if (!username) {
    return null;
  }

  return {
    id: trimTo(input && input.id, 120) || crypto.randomUUID(),
    name: trimTo(input && input.name, 160) || username,
    username,
    role: normalizeRole(input && input.role),
    status: trimTo(input && input.status, 40) === 'disabled' ? 'disabled' : 'active',
    passwordHash: trimTo(input && input.passwordHash, 500),
    createdAt: trimTo(input && input.createdAt, 80) || now,
    updatedAt: trimTo(input && input.updatedAt, 80) || now
  };
}

function sanitizeAdminUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    status: user.status,
    permissions: getRolePermissions(user.role),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

async function ensureAdminUsers() {
  if (hasDatabaseConnection()) {
    const timestamp = new Date().toISOString();
    const seedUser = getDefaultSeedUser();

    if (seedUser) {
      const ensureKey = `${seedUser.username}:${seedUser.passwordHash}`;

      if (databaseSeedEnsureState.expiresAt <= Date.now() || databaseSeedEnsureState.username !== ensureKey) {
        const existing = await readDatabaseUserByIdentity(seedUser.username);
        const nextSeed = normalizeStoredUser({
          ...seedUser,
          id: existing && existing.id ? existing.id : seedUser.id,
          updatedAt: timestamp
        }, timestamp);

        if (
          !existing
          || existing.name !== nextSeed.name
          || existing.role !== nextSeed.role
          || existing.status !== nextSeed.status
          || !safeEqual(existing.passwordHash, nextSeed.passwordHash)
        ) {
          await writeDatabaseUser(nextSeed);
        }

        databaseSeedEnsureState = {
          expiresAt: Date.now() + USER_LIST_CACHE_TTL_MS,
          username: ensureKey
        };
      }
    }

    if (adminUserListCache.users && adminUserListCache.expiresAt > Date.now()) {
      return adminUserListCache.users;
    }

    const users = await readDatabaseUsers();
    adminUserListCache = {
      expiresAt: Date.now() + USER_LIST_CACHE_TTL_MS,
      users
    };

    users.forEach((entry) => {
      setCachedEntry(adminUserCache, trimTo(entry.id, 120), entry, USER_CACHE_TTL_MS);
      setCachedEntry(adminUserCache, entry.username, entry, USER_CACHE_TTL_MS);
    });

    return users;
  }

  const rawUsers = await readUserStore();
  const timestamp = new Date().toISOString();
  const normalizedUsers = Array.isArray(rawUsers)
    ? rawUsers.map((entry) => normalizeStoredUser(entry, timestamp)).filter(Boolean)
    : [];

  let changed = !Array.isArray(rawUsers) || normalizedUsers.length !== rawUsers.length;
  const seedUser = getDefaultSeedUser();

  if (seedUser) {
    const existingIndex = normalizedUsers.findIndex((entry) => entry.username === seedUser.username);

    if (existingIndex >= 0) {
      const existing = normalizedUsers[existingIndex];
      const nextSeed = {
        ...existing,
        id: existing.id || seedUser.id,
        name: seedUser.name,
        role: 'founder_admin',
        status: 'active',
        passwordHash: seedUser.passwordHash,
        updatedAt: timestamp
      };

      if (
        existing.name !== nextSeed.name
        || existing.role !== nextSeed.role
        || existing.status !== nextSeed.status
        || !safeEqual(existing.passwordHash, nextSeed.passwordHash)
      ) {
        normalizedUsers[existingIndex] = nextSeed;
        changed = true;
      }
    } else {
      normalizedUsers.unshift(seedUser);
      changed = true;
    }
  }

  if (changed) {
    await writeUserStore(normalizedUsers);
  }

  return normalizedUsers;
}

async function listAdminUsers() {
  const users = await ensureAdminUsers();
  return users.map(sanitizeAdminUser);
}

async function listAdminUsersForMigration() {
  return ensureAdminUsers();
}

async function getAdminUserByIdentity(identity) {
  if (!identity) {
    return null;
  }

  if (hasDatabaseConnection()) {
    await ensureAdminUsers();
    return readDatabaseUserByIdentity(identity);
  }

  const users = await ensureAdminUsers();
  const normalizedIdentity = trimTo(identity, 120).toLowerCase();

  return users.find((entry) => entry.id === identity || entry.username === normalizedIdentity) || null;
}

async function createAdminUser(input) {
  const users = await ensureAdminUsers();
  const username = trimTo(input.username, 120).toLowerCase();
  const password = trimTo(input.password, 240);

  if (!username || !password) {
    throw new Error('Username and password are required.');
  }

  if (users.some((entry) => entry.username === username)) {
    throw new Error('That username already exists.');
  }

  const timestamp = new Date().toISOString();
  const user = normalizeStoredUser({
    id: crypto.randomUUID(),
    name: trimTo(input.name, 160) || username,
    username,
    role: normalizeRole(input.role),
    status: 'active',
    passwordHash: createPasswordHash(password),
    createdAt: timestamp,
    updatedAt: timestamp
  }, timestamp);

  if (hasDatabaseConnection()) {
    await writeDatabaseUser(user);
  } else {
    users.unshift(user);
    await writeUserStore(users);
  }

  return sanitizeAdminUser(user);
}

async function updateAdminUser(id, updates) {
  const users = await ensureAdminUsers();
  const index = users.findIndex((entry) => entry.id === id);

  if (index < 0) {
    return null;
  }

  const existing = users[index];
  const timestamp = new Date().toISOString();
  const next = {
    ...existing,
    name: typeof updates.name === 'string' ? trimTo(updates.name, 160) || existing.name : existing.name,
    role: typeof updates.role === 'string' ? normalizeRole(updates.role) : existing.role,
    status: typeof updates.status === 'string' && updates.status === 'disabled' ? 'disabled' : 'active',
    updatedAt: timestamp
  };

  if (typeof updates.password === 'string' && trimTo(updates.password, 240)) {
    next.passwordHash = createPasswordHash(trimTo(updates.password, 240));
  }

  const activeFounderCount = users.filter((entry) => entry.role === 'founder_admin' && entry.status === 'active').length;
  if (existing.role === 'founder_admin' && existing.status === 'active' && (next.role !== 'founder_admin' || next.status !== 'active') && activeFounderCount <= 1) {
    throw new Error('At least one active founder admin must remain.');
  }

  if (hasDatabaseConnection()) {
    await writeDatabaseUser(next);
  } else {
    users[index] = next;
    await writeUserStore(users);
  }

  return sanitizeAdminUser(next);
}

async function createAdminSession(user) {
  if (hasDatabaseConnection() && user && user.id) {
    return createDatabaseSession(user);
  }

  const secret = getSessionSecret();

  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET is not configured yet.');
  }

  const expiresAt = Date.now() + (SESSION_MAX_AGE_SECONDS * 1000);
  return {
    token: buildSessionToken(user, secret, expiresAt),
    expiresAt
  };
}

async function getAdminSession(req) {
  const cookies = getCookieMap(req);
  const headerToken = req.headers['x-admin-session'] || req.headers['X-Admin-Session'] || '';
  const token = cookies[SESSION_COOKIE] || trimTo(headerToken, 500);

  if (!token) {
    return null;
  }

  if (hasDatabaseConnection() && isDatabaseSessionToken(token)) {
    return readDatabaseSession(token);
  }

  const secret = getSessionSecret();

  if (!secret) {
    return null;
  }

  return verifySessionToken(token, secret);
}

async function invalidateAdminSession(req) {
  const cookies = getCookieMap(req);
  const headerToken = req.headers['x-admin-session'] || req.headers['X-Admin-Session'] || '';
  const token = cookies[SESSION_COOKIE] || trimTo(headerToken, 500);

  if (!token) {
    return false;
  }

  if (hasDatabaseConnection() && isDatabaseSessionToken(token)) {
    return invalidateDatabaseSession(token);
  }

  return false;
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

function makeSessionView(user, expiresAt) {
  return {
    id: user.id || '',
    username: user.username,
    name: user.name || user.username,
    role: normalizeRole(user.role),
    permissions: getRolePermissions(user.role),
    expiresAt
  };
}

async function getLoginDefaults() {
  if (hasDatabaseConnection()) {
    await ensureAdminUsers();

    if (loginDefaultsCache.value && loginDefaultsCache.expiresAt > Date.now()) {
      return loginDefaultsCache.value;
    }

    const firstActiveUser = await readDatabaseFirstActiveUser();
    const defaults = {
      username: firstActiveUser ? firstActiveUser.username : getConfiguredAdminCredentials().username
    };

    loginDefaultsCache = {
      expiresAt: Date.now() + LOGIN_DEFAULTS_CACHE_TTL_MS,
      value: defaults
    };

    return defaults;
  }

  const users = await ensureAdminUsers();
  const firstActiveUser = users.find((entry) => entry.status === 'active');

  return {
    username: firstActiveUser ? firstActiveUser.username : getConfiguredAdminCredentials().username
  };
}

async function verifyAdminCredentials(username, password) {
  const normalizedUsername = trimTo(username, 120).toLowerCase();
  let matchedUser = null;

  if (hasDatabaseConnection()) {
    await ensureAdminUsers();
    matchedUser = await readDatabaseUserByIdentity(normalizedUsername);
    if (matchedUser && matchedUser.status !== 'active') {
      matchedUser = null;
    }
  } else {
    const users = await ensureAdminUsers();
    matchedUser = users.find((entry) => entry.username === normalizedUsername && entry.status === 'active');
  }

  if (!matchedUser) {
    return {
      ok: false,
      statusCode: 401,
      message: 'Username or password is incorrect.'
    };
  }

  if (!verifyPasswordHash(password, matchedUser.passwordHash)) {
    return {
      ok: false,
      statusCode: 401,
      message: 'Username or password is incorrect.'
    };
  }

  return {
    ok: true,
    user: sanitizeAdminUser(matchedUser)
  };
}

async function requireAdminAccess(req, requiredPermission) {
  const session = await getAdminSession(req);

  if (session) {
    if (!hasPermission(session.role, requiredPermission || 'dashboard.view')) {
      return {
        ok: false,
        statusCode: 403,
        message: 'You do not have permission for that action.'
      };
    }

    return {
      ok: true,
      session: makeSessionView(session, session.expiresAt)
    };
  }

  const configuredKey = process.env.ADMIN_ACCESS_TOKEN;
  const providedKey = req.headers['x-admin-key'] || req.headers['X-Admin-Key'];

  if (configuredKey && providedKey && safeEqual(providedKey, configuredKey)) {
    const fallbackUser = {
      id: 'legacy-access-token',
      username: 'admin',
      name: 'Legacy Admin Token',
      role: 'founder_admin',
      status: 'active'
    };

    if (!hasPermission(fallbackUser.role, requiredPermission || 'dashboard.view')) {
      return {
        ok: false,
        statusCode: 403,
        message: 'You do not have permission for that action.'
      };
    }

    return {
      ok: true,
      session: makeSessionView(fallbackUser, '')
    };
  }

  const loginDefaults = await getLoginDefaults();
  if (!loginDefaults.username) {
    return {
      ok: false,
      statusCode: 503,
      message: 'Admin authentication is not configured yet.'
    };
  }

  return {
    ok: false,
    statusCode: 401,
    message: 'Admin login required.'
  };
}

module.exports = {
  ADMIN_ROLES,
  SESSION_COOKIE,
  buildLogoutCookie,
  buildSessionCookie,
  createAdminSession,
  invalidateAdminSession,
  getAdminSession,
  getConfiguredAdminCredentials,
  getLoginDefaults,
  getRolePermissions,
  hasPermission,
  listAdminUsers,
  listAdminUsersForMigration,
  createAdminUser,
  updateAdminUser,
  getAdminUserByIdentity,
  requireAdminAccess,
  safeEqual,
  verifyAdminCredentials
};
