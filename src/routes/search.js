import { ok, parseIntParam, badRequest } from '../lib/http.js';
import { search } from '../services/search.js';

export function registerSearchRoutes(router) {
  router.get('/api/search', async (ctx) => {
    const { url } = ctx;
    const q = (url.searchParams.get('q') || '').trim();
    if (!q) throw badRequest('请输入搜索关键词');
    if (q.length > 100) throw badRequest('搜索关键词过长');

    const kindParam = url.searchParams.get('type');
    const kind = kindParam === 'thread' || kindParam === 'post' ? kindParam : null;
    const page = Math.max(1, Number(url.searchParams.get('page') || 1) || 1);
    const pageSize = Math.min(30, Math.max(1, Number(url.searchParams.get('pageSize') || 15) || 15));

    const results = await search(ctx.env, q, { kind, limit: pageSize, offset: (page - 1) * pageSize });
    return ok({
      query: q,
      type: kind,
      results: results.map((r) => ({
        title: r.title,
        kind: r.kind,
        refId: Number(r.refId),
        url: r.url,
        excerpt: r.excerpt
      })),
      pagination: { page, pageSize }
    });
  });
}