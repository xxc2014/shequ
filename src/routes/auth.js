import { readJson, ok, created, json, str, badRequest, conflict, unauthorized, getClientIp } from '../lib/http.js';
import { hashPassword, verifyPassword, checkPasswordStrength } from '../lib/password.js';
import {
  createSession,
  destroySession,
  clearSessionCookie,
  publicUser,
  requireUser,
  validateUsername,
  validateEmail,
  rateLimit
} from '../lib/session.js';
import { createNotification } from '../services/notify.js';

async function registrationOpen(env) {
  if (env.ALLOW_REGISTRATION === 'false') return false;
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'registration_open'").first();
  return !row || row.value !== 'false';
}

export function registerAuthRoutes(router) {
  router.post('/api/auth/register', async (ctx) => {
    const { env, request } = ctx;
    await rateLimit(env, `register:${getClientIp(request)}`, 10, 3600);

    if (!(await registrationOpen(env))) {
      throw badRequest('当前暂未开放注册');
    }

    const body = await readJson(request);
    const username = str(body, 'username', { required: true, min: 3, max: 24, label: '用户名' });
    const email = str(body, 'email', { required: true, max: 254, label: '邮箱' }).toLowerCase();
    const password = str(body, 'password', { required: true, max: 128, label: '密码' });

    validateUsername(username);
    validateEmail(email);
    const strengthError = checkPasswordStrength(password);
    if (strengthError) throw badRequest(strengthError);

    const existing = await env.DB.prepare(
      'SELECT id, email, username FROM users WHERE email = ? OR username = ?'
    )
      .bind(email, username)
      .first();
    if (existing) {
      throw conflict(existing.email === email ? '该邮箱已被注册' : '该用户名已被占用', 'duplicate');
    }

    const now = Math.floor(Date.now() / 1000);
    const passwordHash = await hashPassword(password);
    const result = await env.DB.prepare(
      `INSERT INTO users (username, email, password_hash, display_name, role, status, created_at, updated_at, last_seen_at)
       VALUES (?, ?, ?, ?, 'member', 'active', ?, ?, ?)`
    )
      .bind(username, email, passwordHash, username, now, now, now)
      .run();

    const userId = result.meta.last_row_id;
    await createNotification(env, {
      userId,
      type: 'system',
      title: `欢迎加入 ${env.SITE_NAME || 'DevHub'}！`,
      body: '完善个人资料，然后去论坛打个招呼吧。',
      link: '/forum'
    });

    const { cookie } = await createSession(env, userId, request);
    return created(
      { user: publicUser(await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first()) },
      { 'Set-Cookie': cookie }
    );
  });

  router.post('/api/auth/login', async (ctx) => {
    const { env, request } = ctx;
    const body = await readJson(request);
    const email = str(body, 'email', { required: true, max: 254, label: '邮箱' }).toLowerCase();
    const password = str(body, 'password', { required: true, max: 128, label: '密码' });

    await rateLimit(env, `login:${getClientIp(request)}:${email}`, 10, 900);

    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    const valid = user ? await verifyPassword(password, user.password_hash) : false;
    if (!valid) throw unauthorized('邮箱或密码不正确');
    if (user.status === 'banned') throw unauthorized('账号已被封禁，如有疑问请联系管理员');

    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(now, user.id).run();

    const { cookie } = await createSession(env, user.id, request);
    return json({ ok: true, data: { user: publicUser(user) } }, { headers: { 'Set-Cookie': cookie } });
  });

  router.post('/api/auth/logout', async (ctx) => {
    const { env, request } = ctx;
    await destroySession(env, request);
    return json({ ok: true, data: null }, { headers: { 'Set-Cookie': clearSessionCookie(env) } });
  });

  router.get('/api/auth/me', async (ctx) => {
    const unreadCount = ctx.user
      ? await ctx.env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0')
          .bind(ctx.user.id)
          .first('n')
      : 0;
    return ok({ user: publicUser(ctx.user), unreadCount: unreadCount || 0 });
  });

  router.post('/api/auth/password', async (ctx) => {
    const { env, request } = ctx;
    const user = requireUser(ctx);
    const body = await readJson(request);
    const currentPassword = str(body, 'currentPassword', { required: true, max: 128, label: '当前密码' });
    const newPassword = str(body, 'newPassword', { required: true, max: 128, label: '新密码' });

    const valid = await verifyPassword(currentPassword, user.password_hash);
    if (!valid) throw badRequest('当前密码不正确');
    const strengthError = checkPasswordStrength(newPassword);
    if (strengthError) throw badRequest(strengthError);

    const now = Math.floor(Date.now() / 1000);
    const hash = await hashPassword(newPassword);
    await env.DB.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .bind(hash, now, user.id)
      .run();

    return ok({ message: '密码已更新' });
  });
}