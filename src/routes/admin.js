import {
  readJson,
  ok,
  created,
  str,
  int,
  badRequest,
  notFound,
  conflict,
  parseIntParam,
  getClientIp
} from '../lib/http.js';
import { requireModerator, requireAdmin, requireUser, ROLES, publicUser } from '../lib/session.js';
import { audit } from '../services/audit.js';
import { recalcTagCounts } from '../services/taxonomy.js';

const VALID_ROLES = ['member', 'moderator', 'admin'];
const VALID_STATUS = ['active', 'banned'];

export function registerAdminRoutes(router) {
  // ============ 概览 ============
  router.get('/api/admin/stats', async (ctx) => {
    requireModerator(ctx);
    const { env } = ctx;
    const stats = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM users WHERE created_at > ?) AS new_users_7d,
        (SELECT COUNT(*) FROM threads WHERE status = 'published') AS threads,
        (SELECT COUNT(*) FROM replies WHERE status = 'published') AS replies,
        (SELECT COUNT(*) FROM blog_posts WHERE status = 'published') AS posts,
        (SELECT COUNT(*) FROM blog_posts WHERE status = 'draft') AS drafts,
        (SELECT COUNT(*) FROM reports WHERE status = 'open') AS open_reports`
    )
      .bind(Math.floor(Date.now() / 1000) - 7 * 86400)
      .first();

    const recentUsers = await env.DB.prepare(
      'SELECT id, username, email, role, status, created_at FROM users ORDER BY created_at DESC LIMIT 5'
    ).all();

    return ok({ stats, recentUsers: recentUsers.results || [] });
  });

  // ============ 用户管理 ============
  router.get('/api/admin/users', async (ctx) => {
    requireAdmin(ctx);
    const { env, url } = ctx;
    const page = Math.max(1, Number(url.searchParams.get('page') || 1) || 1);
    const pageSize = 20;
    const q = (url.searchParams.get('q') || '').trim();
    const role = url.searchParams.get('role');

    const where = ['1 = 1'];
    const params = [];
    if (q) {
      where.push('(username LIKE ? OR email LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (VALID_ROLES.includes(role)) {
      where.push('role = ?');
      params.push(role);
    }
    const whereSql = where.join(' AND ');

    const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${whereSql}`).bind(...params).first('n');
    const rows = await env.DB.prepare(
      `SELECT id, username, email, display_name, avatar_url, role, status, created_at, last_seen_at
       FROM users WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
      .bind(...params, pageSize, (page - 1) * pageSize)
      .all();

    return ok({
      users: (rows.results || []).map((u) => ({ ...publicUser(u), email: u.email })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    });
  });

  router.patch('/api/admin/users/:id', async (ctx) => {
    const admin = requireAdmin(ctx);
    const { env } = ctx;
    const id = parseIntParam(ctx.params.id);
    if (!id) throw notFound('用户不存在');
    const target = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
    if (!target) throw notFound('用户不存在');

    const body = await readJson(ctx.request);
    const role = body.role === undefined ? target.role : String(body.role);
    const status = body.status === undefined ? target.status : String(body.status);
    if (!VALID_ROLES.includes(role)) throw badRequest('角色不合法');
    if (!VALID_STATUS.includes(status)) throw badRequest('状态不合法');
    if (target.id === admin.id && role !== 'admin') throw badRequest('不能撤销自己的管理员角色');

    await env.DB.prepare('UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ?')
      .bind(role, status, Math.floor(Date.now() / 1000), id)
      .run();
    await audit(env, {
      actorId: admin.id,
      action: 'admin.update_user',
      targetType: 'user',
      targetId: id,
      meta: { role, status },
      ip: getClientIp(ctx.request)
    });
    return ok({ message: '用户已更新' });
  });

  // ============ 内容审核 ============
  router.patch('/api/admin/threads/:id', async (ctx) => {
    const mod = requireModerator(ctx);
    const { env } = ctx;
    const id = parseIntParam(ctx.params.id);
    if (!id) throw notFound('帖子不存在');
    const thread = await env.DB.prepare('SELECT * FROM threads WHERE id = ?').bind(id).first();
    if (!thread) throw notFound('帖子不存在');

    const body = await readJson(ctx.request);
    const isPinned = body.isPinned === undefined ? thread.is_pinned : body.isPinned ? 1 : 0;
    const isLocked = body.isLocked === undefined ? thread.is_locked : body.isLocked ? 1 : 0;
    const status = body.status === undefined ? thread.status : String(body.status);
    if (!['published', 'hidden', 'deleted'].includes(status)) throw badRequest('状态不合法');

    await env.DB.prepare('UPDATE threads SET is_pinned = ?, is_locked = ?, status = ?, updated_at = ? WHERE id = ?')
      .bind(isPinned, isLocked, status, Math.floor(Date.now() / 1000), id)
      .run();
    await audit(env, {
      actorId: mod.id,
      action: 'admin.update_thread',
      targetType: 'thread',
      targetId: id,
      meta: { isPinned, isLocked, status },
      ip: getClientIp(ctx.request)
    });
    return ok({ message: '帖子已更新' });
  });

  router.patch('/api/admin/replies/:id', async (ctx) => {
    const mod = requireModerator(ctx);
    const { env } = ctx;
    const id = parseIntParam(ctx.params.id);
    if (!id) throw notFound('回复不存在');
    const body = await readJson(ctx.request);
    const status = String(body.status || '');
    if (!['published', 'hidden', 'deleted'].includes(status)) throw badRequest('状态不合法');

    await env.DB.prepare('UPDATE replies SET status = ?, updated_at = ? WHERE id = ?')
      .bind(status, Math.floor(Date.now() / 1000), id)
      .run();
    await audit(env, { actorId: mod.id, action: 'admin.update_reply', targetType: 'reply', targetId: id, meta: { status }, ip: getClientIp(ctx.request) });
    return ok({ message: '回复已更新' });
  });

  // ============ 举报 ============
  router.post('/api/reports', async (ctx) => {
    const user = requireUser(ctx);
    const { env } = ctx;
    const body = await readJson(ctx.request);
    const targetType = str(body, 'targetType', { required: true, max: 20, label: '目标类型' });
    const targetId = int(body, 'targetId', 0);
    const reason = str(body, 'reason', { required: true, max: 100, label: '举报原因' });
    const detail = str(body, 'detail', { max: 1000, label: '补充说明' });
    if (!['thread', 'reply', 'user', 'post'].includes(targetType) || !targetId) throw badRequest('举报目标不合法');

    await env.DB.prepare(
      'INSERT INTO reports (reporter_id, target_type, target_id, reason, detail, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(user.id, targetType, targetId, reason, detail, 'open', Math.floor(Date.now() / 1000))
      .run();
    return created({ message: '举报已提交，感谢反馈' });
  });

  router.get('/api/admin/reports', async (ctx) => {
    requireModerator(ctx);
    const { env, url } = ctx;
    const status = url.searchParams.get('status') || 'open';
    const page = Math.max(1, Number(url.searchParams.get('page') || 1) || 1);
    const pageSize = 20;
    const where = status === 'all' ? '1 = 1' : 'r.status = ?';
    const params = status === 'all' ? [] : [status];

    const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM reports r WHERE ${where}`).bind(...params).first('n');
    const rows = await env.DB.prepare(
      `SELECT r.*, u.username AS reporter_username FROM reports r JOIN users u ON u.id = r.reporter_id
       WHERE ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
    )
      .bind(...params, pageSize, (page - 1) * pageSize)
      .all();

    return ok({
      reports: rows.results || [],
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    });
  });

  router.patch('/api/admin/reports/:id', async (ctx) => {
    const mod = requireModerator(ctx);
    const { env } = ctx;
    const id = parseIntParam(ctx.params.id);
    if (!id) throw notFound('举报不存在');
    const body = await readJson(ctx.request);
    const status = String(body.status || '');
    if (!['open', 'resolved', 'dismissed'].includes(status)) throw badRequest('状态不合法');

    await env.DB.prepare('UPDATE reports SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?')
      .bind(status, Math.floor(Date.now() / 1000), mod.id, id)
      .run();
    await audit(env, { actorId: mod.id, action: 'admin.resolve_report', targetType: 'report', targetId: id, meta: { status }, ip: getClientIp(ctx.request) });
    return ok({ message: '举报已处理' });
  });

  // ============ 审计日志 ============
  router.get('/api/admin/audit', async (ctx) => {
    requireModerator(ctx);
    const page = Math.max(1, Number(ctx.url.searchParams.get('page') || 1) || 1);
    const pageSize = 30;
    const rows = await ctx.env.DB.prepare(
      `SELECT a.*, u.username AS actor_username FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
       ORDER BY a.created_at DESC LIMIT ? OFFSET ?`
    )
      .bind(pageSize, (page - 1) * pageSize)
      .all();
    return ok({ logs: rows.results || [], pagination: { page, pageSize } });
  });

  // ============ 版块管理 ============
  router.post('/api/admin/categories', async (ctx) => {
    const admin = requireAdmin(ctx);
    const { env } = ctx;
    const body = await readJson(ctx.request);
    const name = str(body, 'name', { required: true, max: 40, label: '名称' });
    const slug = str(body, 'slug', { max: 50, label: '标识' }) || name.toLowerCase().replace(/\s+/g, '-');
    const description = str(body, 'description', { max: 200, label: '描述' });
    const icon = str(body, 'icon', { max: 8, label: '图标' });
    const sortOrder = int(body, 'sortOrder', 0);

    const existing = await env.DB.prepare('SELECT id FROM categories WHERE slug = ?').bind(slug).first();
    if (existing) throw conflict('该版块标识已存在');

    const result = await env.DB.prepare(
      'INSERT INTO categories (slug, name, description, icon, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(slug, name, description, icon, sortOrder, Math.floor(Date.now() / 1000))
      .run();
    await audit(env, { actorId: admin.id, action: 'admin.create_category', targetType: 'category', targetId: result.meta.last_row_id, ip: getClientIp(ctx.request) });
    return created({ id: result.meta.last_row_id, slug });
  });

  router.patch('/api/admin/categories/:id', async (ctx) => {
    const admin = requireAdmin(ctx);
    const { env } = ctx;
    const id = parseIntParam(ctx.params.id);
    if (!id) throw notFound('版块不存在');
    const existing = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first();
    if (!existing) throw notFound('版块不存在');

    const body = await readJson(ctx.request);
    const name = str(body, 'name', { max: 40, label: '名称' }) || existing.name;
    const description = body.description === undefined ? existing.description : str(body, 'description', { max: 200, label: '描述' });
    const icon = body.icon === undefined ? existing.icon : str(body, 'icon', { max: 8, label: '图标' });
    const sortOrder = int(body, 'sortOrder', existing.sort_order);

    await env.DB.prepare('UPDATE categories SET name = ?, description = ?, icon = ?, sort_order = ? WHERE id = ?')
      .bind(name, description, icon, sortOrder, id)
      .run();
    await audit(env, { actorId: admin.id, action: 'admin.update_category', targetType: 'category', targetId: id, ip: getClientIp(ctx.request) });
    return ok({ message: '版块已更新' });
  });

  router.delete('/api/admin/categories/:id', async (ctx) => {
    const admin = requireAdmin(ctx);
    const { env } = ctx;
    const id = parseIntParam(ctx.params.id);
    if (!id) throw notFound('版块不存在');
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM threads WHERE category_id = ?').bind(id).first('n');
    if (count > 0) throw badRequest('该版块下仍有帖子，无法删除');

    await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
    await audit(env, { actorId: admin.id, action: 'admin.delete_category', targetType: 'category', targetId: id, ip: getClientIp(ctx.request) });
    return ok({ message: '版块已删除' });
  });

  // ============ 站点设置 ============
  router.patch('/api/admin/settings', async (ctx) => {
    const admin = requireAdmin(ctx);
    const { env } = ctx;
    const body = await readJson(ctx.request);
    const updates = {};
    if (body.siteName !== undefined) updates.site_name = str(body, 'siteName', { max: 60, label: '站点名称' });
    if (body.siteDescription !== undefined) updates.site_description = str(body, 'siteDescription', { max: 200, label: '站点描述' });
    if (body.announcement !== undefined) updates.announcement = str(body, 'announcement', { max: 500, label: '公告' });
    if (body.registrationOpen !== undefined) updates.registration_open = body.registrationOpen ? 'true' : 'false';

    const entries = Object.entries(updates);
    if (entries.length) {
      await env.DB.batch(
        entries.map(([k, v]) =>
          env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v)
        )
      );
    }
    await audit(env, { actorId: admin.id, action: 'admin.update_settings', meta: updates, ip: getClientIp(ctx.request) });
    return ok({ message: '设置已保存' });
  });

  // ============ 全站广播通知 ============
  router.post('/api/admin/broadcast', async (ctx) => {
    const admin = requireAdmin(ctx);
    const { env } = ctx;
    const body = await readJson(ctx.request);
    const title = str(body, 'title', { required: true, max: 100, label: '标题' });
    const content = str(body, 'body', { max: 500, label: '内容' });
    const link = str(body, 'link', { max: 200, label: '链接' });

    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO notifications (user_id, actor_id, type, title, body, link, created_at)
       SELECT id, ?, 'system', ?, ?, ?, ? FROM users WHERE status = 'active'`
    )
      .bind(admin.id, title, content, link, now)
      .run();

    await audit(env, { actorId: admin.id, action: 'admin.broadcast', meta: { title }, ip: getClientIp(ctx.request) });
    return ok({ message: '通知已发送' });
  });

  // 标签计数维护
  router.post('/api/admin/recalc-tags', async (ctx) => {
    requireAdmin(ctx);
    await recalcTagCounts(ctx.env);
    return ok({ message: '标签统计已刷新' });
  });
}