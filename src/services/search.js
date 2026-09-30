// 全文检索索引维护（FTS5 / trigram）
import { stripMarkdown } from '../lib/markdown.js';

export async function indexDoc(env, { kind, refId, title, body, url }) {
  await removeIndex(env, kind, refId);
  await env.DB.prepare(
    'INSERT INTO search_index (title, body, kind, ref_id, url) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(title, stripMarkdown(body, 4000), kind, refId, url)
    .run();
}

export async function removeIndex(env, kind, refId) {
  await env.DB.prepare('DELETE FROM search_index WHERE kind = ? AND ref_id = ?')
    .bind(kind, String(refId))
    .run();
}

function ftsQuery(q) {
  // 用双引号包裹并转义内部引号，避免 FTS 语法注入
  return `"${String(q).replace(/"/g, '""')}"`;
}

export async function search(env, q, { kind = null, limit = 20, offset = 0 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];

  const kindFilter = kind ? ' AND kind = ?' : '';
  const kindParams = kind ? [kind] : [];

  // trigram 分词要求查询长度 >= 3 字符，短查询回退到 LIKE
  if (query.length >= 3) {
    const sql = `SELECT title, kind, ref_id AS refId, url,
        snippet(search_index, 1, '', '', '…', 24) AS excerpt
      FROM search_index
      WHERE search_index MATCH ?${kindFilter}
      ORDER BY rank LIMIT ? OFFSET ?`;
    const result = await env.DB.prepare(sql)
      .bind(ftsQuery(query), ...kindParams, limit, offset)
      .all();
    return result.results || [];
  }

  const like = `%${query}%`;
  const sql = `SELECT title, kind, ref_id AS refId, url, substr(body, 1, 160) AS excerpt
    FROM search_index
    WHERE (title LIKE ? OR body LIKE ?)${kindFilter}
    LIMIT ? OFFSET ?`;
  const result = await env.DB.prepare(sql)
    .bind(like, like, ...kindParams, limit, offset)
    .all();
  return result.results || [];
}