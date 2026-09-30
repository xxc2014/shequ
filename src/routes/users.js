import { readJson, ok, str, notFound, getClientIp } from '../lib/http.js';
import { requireUser, publicUser } from '../lib/session.js';
import { audit } from '../services/audit.js';

export function registerUserRoutes(router) {
  // 个人主页
  router.get('/api/users/:username', async (ctx) => {
    const { env } = ctx;
    const username = ctx.params.username;
    const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
    if (!user) throw notFound('用户不存在');

    const stats = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM threads WHERE author_id = ? AND status = 'published') AS threads,
        (SELECT COUNT(*) FROM replies WHERE author_id = ? AND status = 'published') AS replies,
        (SELECT COUNT(*) FROM blog_posts WHERE author_id = ? AND status = 'published') AS posts,
        (SELECT COALESCE(SUM(like_count), 0) FROM threads WHERE author_id = ?) AS likes`
    )
      .bind(user.id, user.id, user.id, user.id)
      .first();

    return ok({
      user: {
        ...publicUser(user),
        email: ctx.user && (ctx.user.id === user.id || ctx.user.role === 'admin') ? user.email : undefined
      },
      stats: {
        threads: stats.threads,
        replies: stats.replies,
        posts: stats.posts,
        likes: stats.likes
      }
    });
  });

  // 更新个人资料
  router.patch('/api/users/me', async (ctx) => {
    const { env } = ctx;
    const user = requireUser(ctx);
    const body = await readJson(ctx.request);
    const displayName = str(body, 'displayName', { max: 40, label: '昵称' }) || user.display_name;
    const bio = str(body, 'bio', { max: 300, label: '个人简介' });
    const avatarUrl = str(body, 'avatarUrl', { max: 500, label: '头像地址' });

    await env.DB.prepare('UPDATE users SET display_name = ?, bio = ?, avatar_url = ?, updated_at = ? WHERE id = ?')
      .bind(displayName, bio, avatarUrl, Math.floor(Date.now() / 1000), user.id)
      .run();

    const updated = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
    await audit(env, { actorId: user.id, action: 'user.update_profile', targetType: 'user', targetId: user.id, ip: getClientIp(ctx.request) });
    return ok({ user: publicUser(updated) });
  });
}