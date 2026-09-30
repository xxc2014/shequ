import { Router } from './router.js';
import { errorResponse, notFound } from './lib/http.js';
import { resolveUser } from './lib/session.js';
import { renderShell, renderRss, renderSitemap, renderRobots } from './services/seo.js';
import { stripMarkdown } from './lib/markdown.js';
import { recalcTagCounts } from './services/taxonomy.js';
import { serveEmbeddedAsset } from './lib/embedded-assets.js';

import { registerAuthRoutes } from './routes/auth.js';
import { registerUserRoutes } from './routes/users.js';
import { registerForumRoutes } from './routes/forum.js';
import { registerBlogRoutes } from './routes/blog.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerNotificationRoutes } from './routes/notifications.js';
import { registerMetaRoutes } from './routes/meta.js';
import { registerUploadRoutes } from './routes/uploads.js';
import { registerAdminRoutes } from './routes/admin.js';

const router = new Router();
registerAuthRoutes(router);
registerUserRoutes(router);
registerForumRoutes(router);
registerBlogRoutes(router);
registerSearchRoutes(router);
registerNotificationRoutes(router);
registerMetaRoutes(router);
registerUploadRoutes(router);
registerAdminRoutes(router);

async function handleBlogPage(request, env, user) {
  const slug = decodeURIComponent(new URL(request.url).pathname.slice('/blog/'.length)).replace(/\/$/, '');
  const row = await env.DB.prepare(
    `SELECT p.slug, p.title, p.summary, p.body, p.cover_image, p.status, p.author_id, p.published_at,
            u.display_name, u.username
     FROM blog_posts p JOIN users u ON u.id = p.author_id WHERE p.slug = ?`
  )
    .bind(slug)
    .first();

  const siteName = env.SITE_NAME || 'DevHub';
  if (!row || (row.status !== 'published' && !(user && (user.id === row.author_id || user.role !== 'member')))) {
    return renderShell(env, request, {
      title: '文章不存在',
      description: '你访问的文章不存在或已被移除。',
      canonical: `${new URL(request.url).origin}/blog`,
      type: 'website',
      status: 404
    });
  }

  return renderShell(env, request, {
    title: row.title,
    description: row.summary || stripMarkdown(row.body, 160),
    canonical: `${new URL(request.url).origin}/blog/${row.slug}`,
    image: row.cover_image || undefined,
    type: 'article',
    publishedAt: row.published_at || undefined,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: row.title,
      datePublished: row.published_at ? new Date(row.published_at * 1000).toISOString() : undefined,
      author: { '@type': 'Person', name: row.display_name || row.username },
      publisher: { '@type': 'Organization', name: siteName }
    }
  });
}

async function handleThreadPage(request, env, user) {
  const id = Number(new URL(request.url).pathname.slice('/t/'.length).replace(/\/$/, ''));
  const siteName = env.SITE_NAME || 'DevHub';
  const row = Number.isInteger(id)
    ? await env.DB.prepare(
        `SELECT t.id, t.title, t.body, t.status, t.author_id, u.display_name, u.username, c.name AS category_name
         FROM threads t JOIN users u ON u.id = t.author_id JOIN categories c ON c.id = t.category_id
         WHERE t.id = ?`
      )
        .bind(id)
        .first()
    : null;

  if (!row || (row.status !== 'published' && !(user && (user.id === row.author_id || user.role !== 'member')))) {
    return renderShell(env, request, {
      title: '帖子不存在',
      description: '你访问的帖子不存在或已被移除。',
      canonical: `${new URL(request.url).origin}/forum`,
      type: 'website',
      status: 404
    });
  }

  return renderShell(env, request, {
    title: row.title,
    description: stripMarkdown(row.body, 160),
    canonical: `${new URL(request.url).origin}/t/${row.id}`,
    type: 'article',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'DiscussionForumPosting',
      headline: row.title,
      author: { '@type': 'Person', name: row.display_name || row.username },
      publisher: { '@type': 'Organization', name: siteName }
    }
  });
}

export default {
  async fetch(request, env, executionCtx) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (pathname === '/feed.xml') return await renderRss(env, request);
      if (pathname === '/sitemap.xml') return await renderSitemap(env, request);
      if (pathname === '/robots.txt') return await renderRobots(env, request);

      const needsUser =
        pathname.startsWith('/api/') || pathname.startsWith('/blog/') || pathname.startsWith('/t/');
      const user = needsUser ? await resolveUser(env, request) : null;

      if (pathname.startsWith('/blog/')) return await handleBlogPage(request, env, user);

      if (pathname.startsWith('/t/')) return await handleThreadPage(request, env, user);

      const match = router.match(request.method, pathname);
      if (match) {
        const ctx = {
          request,
          env,
          executionCtx,
          url,
          params: match.params,
          user
        };
        const response = await match.handler(ctx);
        return response;
      }

      if (pathname.startsWith('/api/')) {
        throw notFound('接口不存在');
      }

      // 其余交给静态资源（SPA 外壳）
      // 优先使用 Cloudflare 静态资源绑定；未绑定时回退到内嵌资源，保证单脚本部署可用
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return await serveEmbeddedAsset(request);
    } catch (err) {
      return errorResponse(err);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const now = Math.floor(Date.now() / 1000);
        // 清理过期会话
        await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
        // 刷新标签使用计数
        await recalcTagCounts(env);
      })()
    );
  }
};

export { router };