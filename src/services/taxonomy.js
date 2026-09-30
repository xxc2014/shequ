// 标签（论坛与博客共用一张 tags 表）
export async function upsertTags(env, names) {
  const ids = [];
  for (const raw of names) {
    const name = String(raw).trim().slice(0, 30);
    if (!name) continue;
    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]+/gu, '');
    if (!slug) continue;
    await env.DB.prepare('INSERT OR IGNORE INTO tags (slug, name) VALUES (?, ?)').bind(slug, name).run();
    const row = await env.DB.prepare('SELECT id FROM tags WHERE slug = ?').bind(slug).first();
    if (row) ids.push(row.id);
  }
  return [...new Set(ids)];
}

async function tagsMap(env, ids, joinTable, idColumn) {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT j.${idColumn} AS owner_id, tg.slug, tg.name
     FROM ${joinTable} j JOIN tags tg ON tg.id = j.tag_id
     WHERE j.${idColumn} IN (${placeholders})`
  )
    .bind(...ids)
    .all();
  const map = new Map();
  for (const r of rows.results || []) {
    if (!map.has(r.owner_id)) map.set(r.owner_id, []);
    map.get(r.owner_id).push({ slug: r.slug, name: r.name });
  }
  return map;
}

export const tagsForThreads = (env, ids) => tagsMap(env, ids, 'thread_tags', 'thread_id');
export const tagsForPosts = (env, ids) => tagsMap(env, ids, 'blog_post_tags', 'post_id');

export async function recalcTagCounts(env) {
  await env.DB.prepare(
    `UPDATE tags SET use_count = (
       SELECT COUNT(*) FROM thread_tags tt WHERE tt.tag_id = tags.id
     ) + (
       SELECT COUNT(*) FROM blog_post_tags bt WHERE bt.tag_id = tags.id
     )`
  ).run();
}