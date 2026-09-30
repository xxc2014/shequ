import {
  readJson,
  ok,
  created,
  str,
  int,
  badRequest,
  notFound,
  parseIntParam
} from '../lib/http.js';
import { requireUser, requireModerator, assertOwnershipOrRole } from '../lib/session.js';
import { indexDoc, removeIndex } from '../services/search.js';
import { tagsForPosts, upsertTags } from '../services/taxonomy.js';
import { stripMarkdown } from '../lib/markdown.js';
import { slugify } from '../lib/encoding.js';

const POST_SELECT = `
  SELECT p.*, bc.slug AS category_slug, bc.name AS category_name,
         u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar_url
  FROM blog_posts p
  LEFT JOIN blog_categories bc ON bc.id = p.category_id
  JOIN users u ON u.id = p.author_id
`;

function serializePost(row, tags = [], { withBody = false } = {}) {
  const post = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary || stripMarkdown(row.body, 160),
    excerpt: stripMarkdown(row.body, 200),
    coverImage: row.cover_image,
    category: row.category_slug ? { slug: row.category_slug, name: row.category_name } : null,
    author: {
      id: row.author_id,
      username: row.author_username,
      displayName: row.author_display_name,
      avatarUrl: row.author_avatar_url
    },
    tags,
    status: row.status,
    featured: !!row.featured,
    viewCount: row.view_count,
    likeCount: row.like_count,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (withBody) post.body = row.body;
  return post;
}

async function uniqueSlug(env, base, excludeId = 0) {
  let slug = base || 'post';
  let n = 1;
  // 循环直到不冲突
  for (;;) {
    const row = await env.DB.prepare('SELECT id FROM blog_posts WHERE slug = ? AND id != ?')
      .bind(slug, excludeId)
      .first();
    if (!row) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

export function registerBlogRoutes(router) {
  // 博客分类
  router.get('/api/blog/categories', async (ctx) => {
    const rows = await ctx.env.DB.prepare(
      `SELECT bc.*, (SELECT COUNT(*) FROM blog_posts p WHERE p.category_id = bc.id AND p.status = 'published') AS post_count
       FROM blog_categories bc ORDER BY bc.id ASC`
    ).all();
    return ok({
      categories: (rows.results || []).map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        postCount: c.post_count
      }))
    });
  });

  // 我的文章（含草稿）
  router.get('/api/blog/mine', async (ctx) => {
    const user = requireModerator(ctx);
    const rows = await ctx.env.DB.prepare(
      `${POST_SELECT} WHERE p.author_id = ? ORDER BY p.updated_at DESC LIMIT 100`
    )
      .bind(user.id)
      .all();
    const list = rows.results || [];
    const tagMap = await tagsForPosts(ctx.env, list.map((p) => p.id));
    return ok({ posts: list.map((p) => serializePost(p, tagMap.get(p.id) || [])) });
  });

  // 文章列表
  router.get('/api/blog', async (ctx) => {
    const { env, url } = ctx;
    const page = Math.max(1, Number(url.searchParams.get('page') || 1) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize') || 10) || 10));
    const categorySlug = url.searchParams.get('category');
    const tagSlug = url.searchParams.get('tag');
    const authorName = url.searchParams.get('author');
    const featuredOnly = url.searchParams.get('featured') === 'true';

    // 仅管理员/版主可查看草稿
    let includeDrafts = false;
    if (url.searchParams.get('status') === 'all') {
      const { ROLES } = await import('../lib/session.js');
      includeDrafts = !!ctx.user && (ROLES[ctx.user.role] ?? -1) >= ROLES.moderator;
    }

    const where = [includeDrafts ? "p.status IN ('published','draft')" : "p.status = 'published'"];
    const params = [];
    if (categorySlug) {
      where.push('bc.slug = ?');
      params.push(categorySlug);
    }
    if (authorName) {
      where.push('u.username = ?');
      params.push(authorName);
    }
    if (featuredOnly) where.push('p.featured = 1');
    if (tagSlug) {
      where.push('EXISTS (SELECT 1 FROM blog_post_tags bt JOIN tags tg ON tg.id = bt.tag_id WHERE bt.post_id = p.id AND tg.slug = ?)');
      params.push(tagSlug);
    }

    const whereSql = where.join(' AND ');
    const total = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM blog_posts p LEFT JOIN blog_categories bc ON bc.id = p.category_id JOIN users u ON u.id = p.author_id WHERE ${whereSql}`
    )
      .bind(...params)
      .first('n');

    const rows = await env.DB.prepare(
      `${POST_SELECT} WHERE ${whereSql} ORDER BY p.featured DESC, p.published_at DESC, p.created_at DESC LIMIT ? OFFSET ?`
    )
      .bind(...params, pageSize, (page - 1) * pageSize)
      .all();

    const list = rows.results || [];
    const tagMap = await tagsForPosts(env, list.map((p) => p.id));
    return ok({
      posts: list.map((p) => serializePost(p, tagMap.get(p.id) || [])),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    });
  });

  // 新建文章
  router.post('/api/blog', async (ctx) => {
    const { env } = ctx;
    const user = requireModerator(ctx);
    const body = await readJson(ctx.request);
    const title = str(body, 'title', { required: true, min: 4, max: 200, label: '标题' });
    const content = str(body, 'body', { required: true, min: 20, max: 200000, label: '正文' });
    const summary = str(body, 'summary', { max: 300, label: '摘要' }) || stripMarkdown(content, 160);
    const coverImage = str(body, 'coverImage', { max: 500, label: '封面图' });
    const status = body.status === 'published' ? 'published' : 'draft';
    const featured = body.featured === true ? 1 : 0;
    const categorySlug = str(body, 'category', { max: 50, label: '分类' });

    let categoryId = null;
    if (categorySlug) {
      const category = await env.DB.prepare('SELECT id FROM blog_categories WHERE slug = ?').bind(categorySlug).first();
      if (!category) throw badRequest('所选分类不存在');
      categoryId = category.id;
    }

    const now = Math.floor(Date.now() / 1000);
    const slug = await uniqueSlug(env, slugify(title));
    const publishedAt = status === 'published' ? now : 0;

    const result = await env.DB.prepare(
      `INSERT INTO blog_posts (author_id, category_id, title, slug, summary, body, cover_image, status, featured, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(user.id, categoryId, title, slug, summary, content, coverImage, status, featured, publishedAt, now, now)
      .run();

    const postId = result.meta.last_row_id;
    const tagIds = await upsertTags(env, Array.isArray(body.tags) ? body.tags.slice(0, 6) : []);
    if (tagIds.length) {
      await env.DB.batch(
        tagIds.map((tagId) =>
          env.DB.prepare('INSERT OR IGNORE INTO blog_post_tags (post_id, tag_id) VALUES (?, ?)').bind(postId, tagId)
        )
      );
    }
    if (status === 'published') {
      await indexDoc(env, { kind: 'post', refId: postId, title, body: content, url: `/blog/${slug}` });
    }

    const row = await env.DB.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(postId).first();
    const tagMap = await tagsForPosts(env, [postId]);
    return created({ post: serializePost(row, tagMap.get(postId) || [], { withBody: true }) });
  });

  // 文章详情（支持 slug 或数字 id）
  router.get('/api/blog/:idOrSlug', async (ctx) => {
    const { env } = ctx;
    const key = ctx.params.idOrSlug;
    const isId = /^\d+$/.test(key);
    if (!isId && !/^[a-zA-Z0-9\u4e00-\u9fa5-]{1,120}$/.test(key)) throw notFound('文章不存在');

    const row = await env.DB.prepare(`${POST_SELECT} WHERE ${isId ? 'p.id' : 'p.slug'} = ?`)
      .bind(isId ? Number(key) : key)
      .first();
    if (!row) throw notFound('文章不存在');

    if (row.status !== 'published') {
      const { ROLES } = await import('../lib/session.js');
      const level = ctx.user ? ROLES[ctx.user.role] ?? -1 : -1;
      const isOwner = ctx.user && ctx.user.id === row.author_id;
      if (!isOwner && level < ROLES.moderator) throw notFound('文章不存在');
    } else {
      await env.DB.prepare('UPDATE blog_posts SET view_count = view_count + 1 WHERE id = ?').bind(row.id).run();
      row.view_count += 1;
    }

    const tagMap = await tagsForPosts(env, [row.id]);
    let liked = false;
    if (ctx.user) {
      const like = await env.DB.prepare(
        "SELECT 1 FROM likes WHERE user_id = ? AND target_type = 'post' AND target_id = ?"
      )
        .bind(ctx.user.id, row.id)
        .first();
      liked = !!like;
    }

    const post = serializePost(row, tagMap.get(row.id) || [], { withBody: true });
    post.liked = liked;
    return ok({ post });
  });

  // 编辑文章
  router.patch('/api/blog/:id', async (ctx) => {
    const { env } = ctx;
    const id = parseIntParam(ctx.params.id);
    if (!id) throw notFound('文章不存在');
    const existing = await env.DB.prepare('SELECT * FROM blog_posts WHERE id = ?').bind(id).first();
    if (!existing) throw notFound('文章不存在');
    await assertOwnershipOrRole(ctx, existing.author_id, 'moderator');

    const body = await readJson(ctx.request);
    const title = str(body, 'title', { required: true, min: 4, max: 200, label: '标题' });
    const content = str(body, 'body', { required: true, min: 20, max: 200000, label: '正文' });
    const summary = str(body, 'summary', { max: 300, label: '摘要' }) || stripMarkdown(content, 160);
    const coverImage = str(body, 'coverImage', { max: 500, label: '封面图' });
    const status = body.status === 'published' ? 'published' : 'draft';
    const featured = body.featured === true ? 1 : 0;
    const categorySlug = str(body, 'category', { max: 50, label: '分类' });

    let categoryId = existing.category_id;
    if (categorySlug) {
      const category = await env.DB.prepare('SELECT id FROM blog_categories WHERE slug = ?').bind(categorySlug).first();
      if (!category) throw badRequest('所选分类不存在');
      categoryId = category.id;
    }

    const now = Math.floor(Date.now() / 1000);
    const publishedAt = status === 'published' ? existing.published_at || now : 0;

    await env.DB.prepare(
      `UPDATE blog_posts SET title = ?, summary = ?, body = ?, cover_image = ?, status = ?, featured = ?,
         category_id = ?, published_at = ?, updated_at = ? WHERE id = ?`
    )
      .bind(title, summary, coverImage, content, status, featured, categoryId, publishedAt, now, id)
      .run();

    if (Array.isArray(body.tags)) {
      const tagIds = await upsertTags(env, body.tags.slice(0, 6));
      await env.DB.prepare('DELETE FROM blog_post_tags WHERE post_id = ?').bind(id).run();
      if (tagIds.length) {
        await env.DB.batch(
          tagIds.map((tagId) =>
            env.DB.prepare('INSERT OR IGNORE INTO blog_post_tags (post_id, tag_id) VALUES (?, ?)').bind(id, tagId)
          )
        );
      }
    }

    if (status === 'published') {
      await indexDoc(env, { kind: 'post', refId: id, title, body: content, url: `/blog/${existing.slug}` });
    } else {
      await removeIndex(env, 'post', id);
    }

    const row = await env.DB.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(id).first();
    const tagMap = await tagsForPosts(env, [id]);
    return ok({ post: serializePost(row, tagMap.get(id) || [], { withBody: true }) });
  });

  // 删除文章
  router.delete('/api/blog/:id', async (ctx) => {
    const { env } = ctx;
    const id = parseIntParam(ctx.params.id);
    if (!id) throw notFound('文章不存在');
    const existing = await env.DB.prepare('SELECT * FROM blog_posts WHERE id = ?').bind(id).first();
    if (!existing) throw notFound('文章不存在');
    await assertOwnershipOrRole(ctx, existing.author_id, 'moderator');

    await env.DB.prepare('DELETE FROM blog_posts WHERE id = ?').bind(id).run();
    await removeIndex(env, 'post', id);
    return ok({ message: '文章已删除' });
  });
}