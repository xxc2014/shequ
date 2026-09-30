import { ok } from '../lib/http.js';
import { tagsForThreads } from '../services/taxonomy.js';
import { stripMarkdown } from '../lib/markdown.js';

async function getSettingMap(env) {
  const rows = await env.DB.prepare('SELECT key, value FROM settings').all();
  const map = {};
  for (const r of rows.results || []) map[r.key] = r.value;
  return map;
}

async function getStats(env) {
  const row = await env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM threads WHERE status = 'published') AS threads,
      (SELECT COUNT(*) FROM replies WHERE status = 'published') AS replies,
      (SELECT COUNT(*) FROM blog_posts WHERE status = 'published') AS posts`
  ).first();
  return { users: row.users, threads: row.threads, replies: row.replies, posts: row.posts };
}

export function registerMetaRoutes(router) {
  // 站点基础信息（前端启动时拉取）
  router.get('/api/site', async (ctx) => {
    const [settings, stats, categories, tags] = await Promise.all([
      getSettingMap(ctx.env),
      getStats(ctx.env),
      ctx.env.DB.prepare(
        `SELECT c.slug, c.name, c.description, c.icon,
          (SELECT COUNT(*) FROM threads t WHERE t.category_id = c.id AND t.status = 'published') AS thread_count
         FROM categories c ORDER BY c.sort_order ASC, c.id ASC`
      ).all(),
      ctx.env.DB.prepare('SELECT slug, name, use_count FROM tags ORDER BY use_count DESC, id ASC LIMIT 30').all()
    ]);

    return ok({
      settings: {
        siteName: settings.site_name || ctx.env.SITE_NAME,
        siteDescription: settings.site_description || ctx.env.SITE_DESCRIPTION,
        announcement: settings.announcement || '',
        registrationOpen: settings.registration_open !== 'false' && ctx.env.ALLOW_REGISTRATION !== 'false'
      },
      stats,
      categories: categories.results || [],
      tags: tags.results || []
    });
  });

  // 首页聚合数据
  router.get('/api/home', async (ctx) => {
    const { env } = ctx;

    const [featured, latestPosts, latestThreads, hotThreads] = await Promise.all([
      env.DB.prepare(
        `SELECT p.id, p.slug, p.title, p.summary, p.body, p.cover_image, p.published_at, p.like_count,
                bc.slug AS category_slug, bc.name AS category_name,
                u.username, u.display_name, u.avatar_url
         FROM blog_posts p
         LEFT JOIN blog_categories bc ON bc.id = p.category_id
         JOIN users u ON u.id = p.author_id
         WHERE p.status = 'published' ORDER BY p.featured DESC, p.published_at DESC LIMIT 4`
      ).all(),
      env.DB.prepare(
        `SELECT p.id, p.slug, p.title, p.summary, p.body, p.published_at, p.like_count, p.view_count,
                bc.slug AS category_slug, bc.name AS category_name,
                u.username, u.display_name
         FROM blog_posts p
         LEFT JOIN blog_categories bc ON bc.id = p.category_id
         JOIN users u ON u.id = p.author_id
         WHERE p.status = 'published' ORDER BY p.published_at DESC LIMIT 6`
      ).all(),
      env.DB.prepare(
        `SELECT t.id, t.title, t.body, t.reply_count, t.like_count, t.view_count, t.created_at, t.last_reply_at,
                c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon,
                u.username, u.display_name, u.avatar_url
         FROM threads t JOIN categories c ON c.id = t.category_id JOIN users u ON u.id = t.author_id
         WHERE t.status = 'published' ORDER BY COALESCE(NULLIF(t.last_reply_at,0), t.created_at) DESC LIMIT 8`
      ).all(),
      env.DB.prepare(
        `SELECT t.id, t.title, t.body, t.reply_count, t.like_count, t.view_count, t.created_at,
                c.slug AS category_slug, c.name AS category_name,
                u.username, u.display_name
         FROM threads t JOIN categories c ON c.id = t.category_id JOIN users u ON u.id = t.author_id
         WHERE t.status = 'published'
         ORDER BY (t.like_count * 3 + t.reply_count * 5 + t.view_count * 0.1) DESC LIMIT 5`
      ).all()
    ]);

    const mapPost = (p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      summary: p.summary || stripMarkdown(p.body, 140),
      coverImage: p.cover_image,
      category: p.category_slug ? { slug: p.category_slug, name: p.category_name } : null,
      author: { username: p.username, displayName: p.display_name, avatarUrl: p.avatar_url },
      likeCount: p.like_count,
      viewCount: p.view_count,
      publishedAt: p.published_at
    });

    const mapThread = (t) => ({
      id: t.id,
      title: t.title,
      excerpt: stripMarkdown(t.body, 120),
      category: { slug: t.category_slug, name: t.category_name, icon: t.category_icon },
      author: { username: t.username, displayName: t.display_name, avatarUrl: t.avatar_url },
      replyCount: t.reply_count,
      likeCount: t.like_count,
      viewCount: t.view_count,
      createdAt: t.created_at,
      lastReplyAt: t.last_reply_at
    });

    const threadIds = (hotThreads.results || []).map((t) => t.id);
    const tagMap = await tagsForThreads(env, threadIds);

    return ok({
      featuredPosts: (featured.results || []).map(mapPost),
      latestPosts: (latestPosts.results || []).map(mapPost),
      latestThreads: (latestThreads.results || []).map(mapThread),
      hotThreads: (hotThreads.results || []).map((t) => ({ ...mapThread(t), tags: tagMap.get(t.id) || [] })),
      stats: await getStats(env)
    });
  });
}

export { getSettingMap, getStats };