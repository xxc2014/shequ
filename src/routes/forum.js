import {
  readJson,
  ok,
  created,
  str,
  int,
  badRequest,
  notFound,
  forbidden,
  parseIntParam
} from '../lib/http.js';
import { requireUser, assertOwnershipOrRole, publicUser } from '../lib/session.js';
import { indexDoc, removeIndex } from '../services/search.js';
import { createNotification, notifyMentions } from '../services/notify.js';
import { tagsForThreads, upsertTags } from '../services/taxonomy.js';
import { stripMarkdown } from '../lib/markdown.js';

const SORTS = {
  latest: 't.is_pinned DESC, COALESCE(NULLIF(t.last_reply_at, 0), t.created_at) DESC',
  hot: '(t.like_count * 3 + t.reply_count * 5) DESC, t.last_reply_at DESC',
  top: 't.like_count DESC, t.reply_count DESC, t.created_at DESC'
};

function serializeThread(row, tags = [], author = null) {
  return {
    id: row.id,
    title: row.title,
    excerpt: stripMarkdown(row.body, 180),
    category: row.category_slug
      ? { slug: row.category_slug, name: row.category_name, icon: row.category_icon }
      : null,
    author: author || { id: row.author_id, username: row.author_username, displayName: row.author_display_name, avatarUrl: row.author_avatar_url },
    isPinned: !!row.is_pinned,
    isLocked: !!row.is_locked,
    status: row.status,
    viewCount: row.view_count,
    replyCount: row.reply_count,
    likeCount: row.like_count,
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastReplyAt: row.last_reply_at
  };
}

const THREAD_SELECT = `
  SELECT t.*, c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon,
         u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar_url
  FROM threads t
  JOIN categories c ON c.id = t.category_id
  JOIN users u ON u.id = t.author_id
`;

export function registerForumRoutes(router) {
  // 版块列表（带帖子数）
  router.get('/api/categories', async (ctx) => {
    const rows = await ctx.env.DB.prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM threads t WHERE t.category_id = c.id AND t.status = 'published') AS thread_count
       FROM categories c ORDER BY sort_order ASC, id ASC`
    ).all();
    return ok({
      categories: (rows.results || []).map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        icon: c.icon,
        threadCount: c.thread_count
      }))
    });
  });

  // 帖子列表
  router.get('/api/threads', async (ctx) => {
    const { env, url } = ctx;
    const page = Math.max(1, Number(url.searchParams.get('page') || 1) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get('pageSize') || 20) || 20));
    const sort = SORTS[url.searchParams.get('sort')] ? url.searchParams.get('sort') : 'latest';
    const categorySlug = url.searchParams.get('category');
    const tagSlug = url.searchParams.get('tag');
    const authorName = url.searchParams.get('author');

    const where = ["t.status = 'published'"];
    const params = [];
    if (categorySlug) {
      where.push('c.slug = ?');
      params.push(categorySlug);
    }
    if (authorName) {
      where.push('u.username = ?');
      params.push(authorName);
    }
    if (tagSlug) {
      where.push('EXISTS (SELECT 1 FROM thread_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.thread_id = t.id AND tg.slug = ?)');
      params.push(tagSlug);
    }

    const total = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM threads t JOIN categories c ON c.id = t.category_id JOIN users u ON u.id = t.author_id WHERE ${where.join(' AND ')}`
    )
      .bind(...params)
      .first('n');

    const rows = await env.DB.prepare(
      `${THREAD_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${SORTS[sort]} LIMIT ? OFFSET ?`
    )
      .bind(...params, pageSize, (page - 1) * pageSize)
      .all();

    const list = rows.results || [];
    const tagMap = await tagsForThreads(env, list.map((t) => t.id));
    return ok({
      threads: list.map((t) => serializeThread(t, tagMap.get(t.id) || [])),
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      sort
    });
  });

  // 发帖
  router.post('/api/threads', async (ctx) => {
    const { env } = ctx;
    const user = requireUser(ctx);
    const body = await readJson(ctx.request);
    const title = str(body, 'title', { required: true, min: 4, max: 150, label: '标题' });
    const content = str(body, 'body', { required: true, min: 10, max: 50000, label: '正文' });
    const categorySlug = str(body, 'category', { required: true, max: 50, label: '版块' });

    const category = await env.DB.prepare('SELECT id FROM categories WHERE slug = ?').bind(categorySlug).first();
    if (!category) throw badRequest('所选版块不存在');

    const tagNames = Array.isArray(body.tags) ? body.tags.slice(0, 5) : [];
    const now = Math.floor(Date.now() / 1000);
    const result = await env.DB.prepare(
      `INSERT INTO threads (category_id, author_id, title, body, status, last_reply_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'published', ?, ?, ?)`
    )
      .bind(category.id, user.id, title, content, now, now, now)
      .run();

    const threadId = result.meta.last_row_id;
    const tagIds = await upsertTags(env, tagNames);
    if (tagIds.length) {
      await env.DB.batch(
        tagIds.map((tagId) =>
          env.DB.prepare('INSERT OR IGNORE INTO thread_tags (thread_id, tag_id) VALUES (?, ?)').bind(threadId, tagId)
        )
      );
    }

    await indexDoc(env, {
      kind: 'thread',
      refId: threadId,
      title,
      body: content,
      url: `/t/${threadId}`
    });

    const row = await env.DB.prepare(`${THREAD_SELECT} WHERE t.id = ?`).bind(threadId).first();
    const tagMap = await tagsForThreads(env, [threadId]);
    return created({ thread: serializeThread(row, tagMap.get(threadId) || []) });
  });

  // 帖子详情
  router.get('/api/threads/:id', async (ctx) => {
    const { env } = ctx;
    const id = parseIntParam(ctx.params.id);
    if (!id) throw notFound('帖子不存在');

    const row = await env.DB.prepare(`${THREAD_SELECT} WHERE t.id = ?`).bind(id).first();
    if (!row || row.status === 'deleted') throw notFound('帖子不存在');
    if (row.status === 'hidden' && !ctx.user) throw notFound('帖子不存在');

    await env.DB.prepare('UPDATE threads SET view_count = view_count + 1 WHERE id = ?').bind(id).run();
    row.view_count += 1;

    const tagMap = await tagsForThreads(env, [id]);
    let liked = false;
    if (ctx.user) {
      const like = await env.DB.prepare(
        "SELECT 1 FROM likes WHERE user_id = ? AND target_type = 'thread' AND target_id = ?"
      )
        .bind(ctx.user.id, id)
        .first();
      liked = !!like;
    }

    const thread = serializeThread(row, tagMap.get(id) || []);
    thread.body = row.body;
    thread.liked = liked;
    return ok({ thread });
  });

  // 编辑帖子
  router.patch('/api/threads/:id', async (ctx) => {
    const { env } = ctx;
    const id = parseIntParam(ctx.params.id);
    if (!id) throw notFound('帖子不存在');
    const existing = await env.DB.prepare('SELECT * FROM threads WHERE id = ?').bind(id).first();
    if (!existing || existing.status === 'deleted') throw notFound('帖子不存在');
    await assertOwnershipOrRole(ctx, existing.author_id, 'moderator');

    const body = await readJson(ctx.request);
    const title = str(body, 'title', { required: true, min: 4, max: 150, label: '标题' });
    const content = str(body, 'body', { required: true, min: 10, max: 50000, label: '正文' });
    const now = Math.floor(Date.now() / 1000);

    await env.DB.prepare('UPDATE threads SET title = ?, body = ?, updated_at = ? WHERE id = ?')
      .bind(title, content, now, id)
      .run();
    await indexDoc(env, { kind: 'thread', refId: id, title, body: content, url: `/t/${id}` });

    const row = await env.DB.prepare(`${THREAD_SELECT} WHERE t.id = ?`).bind(id).first();
    const tagMap = await tagsForThreads(env, [id]);
    const thread = serializeThread(row, tagMap.get(id) || []);
    thread.body = row.body;
    return ok({ thread });
  });

  // 删除帖子（软删除）
  router.delete('/api/threads/:id', async (ctx) => {
    const { env } = ctx;
    const id = parseIntParam(ctx.params.id);
    if (!id) throw notFound('帖子不存在');
    const existing = await env.DB.prepare('SELECT * FROM threads WHERE id = ?').bind(id).first();
    if (!existing || existing.status === 'deleted') throw notFound('帖子不存在');
    await assertOwnershipOrRole(ctx, existing.author_id, 'moderator');

    await env.DB.prepare("UPDATE threads SET status = 'deleted', updated_at = ? WHERE id = ?")
      .bind(Math.floor(Date.now() / 1000), id)
      .run();
    await removeIndex(env, 'thread', id);
    return ok({ message: '帖子已删除' });
  });

  // 回复列表
  router.get('/api/threads/:id/replies', async (ctx) => {
    const { env } = ctx;
    const id = parseIntParam(ctx.params.id);
    if (!id) throw notFound('帖子不存在');

    const rows = await env.DB.prepare(
      `SELECT r.*, u.username, u.display_name, u.avatar_url, u.role
       FROM replies r JOIN users u ON u.id = r.author_id
       WHERE r.thread_id = ? AND r.status = 'published'
       ORDER BY r.created_at ASC`
    )
      .bind(id)
      .all();

    const list = rows.results || [];
    const likedSet = new Set();
    if (ctx.user && list.length) {
      const placeholders = list.map(() => '?').join(',');
      const likes = await env.DB.prepare(
        `SELECT target_id FROM likes WHERE user_id = ? AND target_type = 'reply' AND target_id IN (${placeholders})`
      )
        .bind(ctx.user.id, ...list.map((r) => r.id))
        .all();
      for (const l of likes.results || []) likedSet.add(l.target_id);
    }

    return ok({
      replies: list.map((r) => ({
        id: r.id,
        threadId: r.thread_id,
        parentId: r.parent_id,
        body: r.body,
        likeCount: r.like_count,
        liked: likedSet.has(r.id),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        author: {
          id: r.author_id,
          username: r.username,
          displayName: r.display_name,
          avatarUrl: r.avatar_url,
          role: r.role
        }
      }))
    });
  });

  // 发表回复
  router.post('/api/threads/:id/replies', async (ctx) => {
    const { env } = ctx;
    const user = requireUser(ctx);
    const threadId = parseIntParam(ctx.params.id);
    if (!threadId) throw notFound('帖子不存在');

    const thread = await env.DB.prepare('SELECT id, author_id, title, is_locked, status FROM threads WHERE id = ?')
      .bind(threadId)
      .first();
    if (!thread || thread.status !== 'published') throw notFound('帖子不存在');
    if (thread.is_locked) throw forbidden('该帖子已锁定，无法回复');

    const body = await readJson(ctx.request);
    const content = str(body, 'body', { required: true, min: 1, max: 20000, label: '回复内容' });
    const parentId = int(body, 'parentId', 0) || null;
    const now = Math.floor(Date.now() / 1000);

    const result = await env.DB.prepare(
      `INSERT INTO replies (thread_id, author_id, parent_id, body, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'published', ?, ?)`
    )
      .bind(threadId, user.id, parentId, content, now, now)
      .run();

    await env.DB.prepare('UPDATE threads SET reply_count = reply_count + 1, last_reply_at = ? WHERE id = ?')
      .bind(now, threadId)
      .run();

    await createNotification(env, {
      userId: thread.author_id,
      actorId: user.id,
      type: 'reply',
      title: `${user.display_name || user.username} 回复了你的帖子`,
      body: stripMarkdown(content, 120),
      link: `/t/${threadId}`
    });
    await notifyMentions(env, content, {
      actorId: user.id,
      link: `/t/${threadId}`,
      title: `${user.display_name || user.username} 在帖子中提到了你`
    });

    return created({ reply: { id: result.meta.last_row_id, threadId } });
  });

  // 编辑回复
  router.patch('/api/replies/:id', async (ctx) => {
    const { env } = ctx;
    const id = parseIntParam(ctx.params.id);
    if (!id) throw notFound('回复不存在');
    const existing = await env.DB.prepare('SELECT * FROM replies WHERE id = ?').bind(id).first();
    if (!existing || existing.status !== 'published') throw notFound('回复不存在');
    await assertOwnershipOrRole(ctx, existing.author_id, 'moderator');

    const body = await readJson(ctx.request);
    const content = str(body, 'body', { required: true, min: 1, max: 20000, label: '回复内容' });
    await env.DB.prepare('UPDATE replies SET body = ?, updated_at = ? WHERE id = ?')
      .bind(content, Math.floor(Date.now() / 1000), id)
      .run();
    return ok({ message: '回复已更新' });
  });

  // 删除回复（软删除）
  router.delete('/api/replies/:id', async (ctx) => {
    const { env } = ctx;
    const id = parseIntParam(ctx.params.id);
    if (!id) throw notFound('回复不存在');
    const existing = await env.DB.prepare('SELECT * FROM replies WHERE id = ?').bind(id).first();
    if (!existing || existing.status !== 'published') throw notFound('回复不存在');
    await assertOwnershipOrRole(ctx, existing.author_id, 'moderator');

    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare("UPDATE replies SET status = 'deleted', body = '[该回复已删除]', updated_at = ? WHERE id = ?").bind(now, id),
      env.DB.prepare('UPDATE threads SET reply_count = MAX(reply_count - 1, 0) WHERE id = ?').bind(existing.thread_id)
    ]);
    return ok({ message: '回复已删除' });
  });

  // 点赞 / 取消点赞（帖子或回复）
  router.post('/api/likes', async (ctx) => {
    const { env } = ctx;
    const user = requireUser(ctx);
    const body = await readJson(ctx.request);
    const targetType = str(body, 'targetType', { required: true, max: 20, label: '目标类型' });
    const targetId = int(body, 'targetId', 0);

    const config = {
      thread: { table: 'threads' },
      post: { table: 'blog_posts' },
      reply: { table: 'replies' }
    }[targetType];
    if (!config || !targetId) throw badRequest('点赞目标不合法');

    const existing = await env.DB.prepare(
      'SELECT id FROM likes WHERE user_id = ? AND target_type = ? AND target_id = ?'
    )
      .bind(user.id, targetType, targetId)
      .first();

    if (existing) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM likes WHERE id = ?').bind(existing.id),
        env.DB.prepare(`UPDATE ${config.table} SET like_count = MAX(like_count - 1, 0) WHERE id = ?`).bind(targetId)
      ]);
      const count = await env.DB.prepare(`SELECT like_count AS n FROM ${config.table} WHERE id = ?`).bind(targetId).first('n');
      return ok({ liked: false, likeCount: count || 0 });
    }

    await env.DB.batch([
      env.DB.prepare('INSERT INTO likes (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)')
        .bind(user.id, targetType, targetId, Math.floor(Date.now() / 1000)),
      env.DB.prepare(`UPDATE ${config.table} SET like_count = like_count + 1 WHERE id = ?`).bind(targetId)
    ]);

    // 给作者发通知
    if (targetType === 'thread' || targetType === 'post') {
      const owner = await env.DB.prepare(
        targetType === 'post'
          ? 'SELECT author_id, slug FROM blog_posts WHERE id = ?'
          : 'SELECT author_id FROM threads WHERE id = ?'
      )
        .bind(targetId)
        .first();
      if (owner) {
        await createNotification(env, {
          userId: owner.author_id,
          actorId: user.id,
          type: 'like',
          title: `${user.display_name || user.username} 赞了你的内容`,
          link: targetType === 'thread' ? `/t/${targetId}` : `/blog/${owner.slug}`
        });
      }
    }

    const count = await env.DB.prepare(`SELECT like_count AS n FROM ${config.table} WHERE id = ?`).bind(targetId).first('n');
    return ok({ liked: true, likeCount: count || 0 });
  });

  // 标签列表
  router.get('/api/tags', async (ctx) => {
    const rows = await ctx.env.DB.prepare('SELECT slug, name, use_count FROM tags ORDER BY use_count DESC LIMIT 50').all();
    return ok({ tags: rows.results || [] });
  });
}