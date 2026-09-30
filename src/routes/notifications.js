import { readJson, ok, int, parseIntParam } from '../lib/http.js';
import { requireUser } from '../lib/session.js';

export function registerNotificationRoutes(router) {
  router.get('/api/notifications', async (ctx) => {
    const user = requireUser(ctx);
    const page = Math.max(1, Number(ctx.url.searchParams.get('page') || 1) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(ctx.url.searchParams.get('pageSize') || 20) || 20));
    const onlyUnread = ctx.url.searchParams.get('unread') === 'true';

    const where = ['n.user_id = ?'];
    if (onlyUnread) where.push('n.is_read = 0');
    const whereSql = where.join(' AND ');

    const total = await ctx.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM notifications n WHERE ${whereSql}`
    )
      .bind(user.id)
      .first('n');

    const rows = await ctx.env.DB.prepare(
      `SELECT n.*, u.username AS actor_username, u.display_name AS actor_display_name, u.avatar_url AS actor_avatar_url
       FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
       WHERE ${whereSql} ORDER BY n.created_at DESC LIMIT ? OFFSET ?`
    )
      .bind(user.id, pageSize, (page - 1) * pageSize)
      .all();

    return ok({
      notifications: (rows.results || []).map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        isRead: !!n.is_read,
        createdAt: n.created_at,
        actor: n.actor_id
          ? { id: n.actor_id, username: n.actor_username, displayName: n.actor_display_name, avatarUrl: n.actor_avatar_url }
          : null
      })),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    });
  });

  router.get('/api/notifications/unread-count', async (ctx) => {
    const user = requireUser(ctx);
    const count = await ctx.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0'
    )
      .bind(user.id)
      .first('n');
    return ok({ count: count || 0 });
  });

  // 标记单条或多条已读
  router.post('/api/notifications/read', async (ctx) => {
    const user = requireUser(ctx);
    const body = await readJson(ctx.request);
    const ids = Array.isArray(body.ids) ? body.ids.map((v) => Number(v)).filter(Number.isInteger) : [];
    if (!ids.length) {
      // 未指定则全部标记已读
      await ctx.env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(user.id).run();
      return ok({ message: '已全部标记为已读' });
    }
    const placeholders = ids.map(() => '?').join(',');
    await ctx.env.DB.prepare(
      `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN (${placeholders})`
    )
      .bind(user.id, ...ids)
      .run();
    return ok({ message: '已标记为已读' });
  });

  router.delete('/api/notifications/:id', async (ctx) => {
    const user = requireUser(ctx);
    const id = parseIntParam(ctx.params.id);
    if (!id) return ok({ message: 'ok' });
    await ctx.env.DB.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').bind(id, user.id).run();
    return ok({ message: '通知已删除' });
  });
}