import { randomHex, sha256Hex } from './encoding.js';
import { unauthorized, forbidden, badRequest } from './http.js';

const COOKIE_NAME = 'devhub_sid';
const DEFAULT_TTL = 60 * 60 * 24 * 30; // 30 天

export const ROLES = { member: 0, moderator: 1, admin: 2 };

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at
  };
}

export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function sessionTtl(env) {
  const ttl = Number(env.SESSION_TTL);
  return Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TTL;
}

function cookieAttributes(env, maxAge) {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (env.ENVIRONMENT === 'production') attrs.push('Secure');
  return attrs.join('; ');
}

export async function createSession(env, userId, request) {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  const ttl = sessionTtl(env);
  const expiresAt = now + ttl;

  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(
      tokenHash,
      userId,
      now,
      expiresAt,
      (request.headers.get('User-Agent') || '').slice(0, 300),
      request.headers.get('CF-Connecting-IP') || ''
    )
    .run();

  await env.KV.put(`sess:${tokenHash}`, String(userId), { expirationTtl: ttl });

  const cookie = `${COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieAttributes(env, ttl)}`;
  return { token, cookie };
}

export function clearSessionCookie(env) {
  return `${COOKIE_NAME}=; ${cookieAttributes(env, 0)}`;
}

// 解析当前登录用户；无有效会话返回 null
export async function resolveUser(env, request) {
  const cookies = parseCookies(request);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  const tokenHash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);

  let userId = null;
  const cached = await env.KV.get(`sess:${tokenHash}`);
  if (cached) {
    userId = Number(cached);
  } else {
    const session = await env.DB.prepare(
      'SELECT user_id, expires_at FROM sessions WHERE id = ?'
    )
      .bind(tokenHash)
      .first();
    if (!session) return null;
    if (session.expires_at <= now) {
      await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(tokenHash).run();
      return null;
    }
    userId = session.user_id;
    const remaining = session.expires_at - now;
    if (remaining > 60) {
      await env.KV.put(`sess:${tokenHash}`, String(userId), { expirationTtl: remaining });
    }
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  if (!user) return null;
  if (user.status === 'banned') return null;
  return user;
}

export function requireUser(ctx) {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
}

export function requireRole(ctx, minRole) {
  const user = requireUser(ctx);
  const level = ROLES[user.role] ?? -1;
  if (level < ROLES[minRole]) throw forbidden();
  return user;
}

export const requireModerator = (ctx) => requireRole(ctx, 'moderator');
export const requireAdmin = (ctx) => requireRole(ctx, 'admin');

export async function assertOwnershipOrRole(ctx, ownerId, minRole) {
  const user = requireUser(ctx);
  if (user.id === ownerId) return user;
  const level = ROLES[user.role] ?? -1;
  if (level >= ROLES[minRole]) return user;
  throw forbidden();
}

export async function destroySession(env, request) {
  const cookies = parseCookies(request);
  const token = cookies[COOKIE_NAME];
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(tokenHash).run();
  await env.KV.delete(`sess:${tokenHash}`);
}

export async function destroyAllSessions(env, userId) {
  const rows = await env.DB.prepare('SELECT id FROM sessions WHERE user_id = ?').bind(userId).all();
  const keys = (rows.results || []).map((r) => `sess:${r.id}`);
  if (keys.length) await Promise.all(keys.map((k) => env.KV.delete(k)));
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

// 轻量限流：基于 KV 计数，超过阈值抛出 429
export async function rateLimit(env, key, limit, windowSeconds) {
  const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
  const current = Number((await env.KV.get(bucket)) || 0);
  if (current >= limit) {
    const { tooMany } = await import('./http.js');
    throw tooMany();
  }
  await env.KV.put(bucket, String(current + 1), { expirationTtl: windowSeconds });
}

export function validateUsername(username) {
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
    throw badRequest('用户名需为 3-24 位的字母、数字或下划线');
  }
}

export function validateEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw badRequest('邮箱格式不正确');
  }
}