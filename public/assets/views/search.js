import { api, buildQuery } from '../api.js';
import { escapeHtml, emptyState } from '../ui.js';

const TYPES = [
  { key: '', label: '全部' },
  { key: 'thread', label: '帖子' },
  { key: 'post', label: '文章' }
];

const PAGE_SIZE = 15;

function resultRow(r) {
  const isPost = r.kind === 'post';
  const url = r.url || (isPost ? `/blog/${r.refId}` : `/t/${r.refId}`);
  return `
    <a class="list-row" href="${escapeHtml(url)}" data-link>
      <span class="pill ${isPost ? 'primary' : 'gray'}">${isPost ? '文章' : '帖子'}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;">${escapeHtml(r.title)}</div>
        ${r.excerpt ? `<div class="small muted" style="margin-top:4px;">${escapeHtml(r.excerpt)}</div>` : ''}
      </div>
    </a>`;
}

export async function searchView(ctx) {
  const q = (ctx.query.get('q') || '').trim();
  const type = ['thread', 'post'].includes(ctx.query.get('type')) ? ctx.query.get('type') : '';
  const page = Math.max(1, Number(ctx.query.get('page') || 1) || 1);

  ctx.setTitle(q ? `搜索：${q}` : '搜索');

  if (!q) {
    ctx.el.innerHTML = `
      <div class="container" style="max-width:760px;">
        <h1 style="font-size:22px;margin:0 0 16px;">搜索</h1>
        <form class="card card-pad" data-search-form>
          <div class="field" style="margin-bottom:12px;">
            <label for="q">关键词</label>
            <input class="input" id="q" name="q" type="search" placeholder="搜索帖子与文章，如：Workers、D1、部署" autofocus>
          </div>
          <button class="btn" type="submit">搜索</button>
        </form>
        <p class="muted small" style="margin-top:16px;">提示：至少输入 3 个字符可获得最佳匹配效果。</p>
      </div>`;
    const form = ctx.el.querySelector('[data-search-form]');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = form.q.value.trim();
      if (value) ctx.navigate(`/search?q=${encodeURIComponent(value)}`);
    });
    return;
  }

  let data;
  try {
    data = await api.get(`/api/search${buildQuery({ q, type, page, pageSize: PAGE_SIZE })}`);
  } catch (err) {
    ctx.el.innerHTML = `<div class="container">${emptyState('搜索失败', err.message, '<a class="btn" href="/search" data-link>重新搜索</a>')}</div>`;
    return;
  }

  const results = data.results || [];
  const hasPrev = page > 1;
  const hasNext = results.length === PAGE_SIZE;

  ctx.el.innerHTML = `
    <div class="container" style="max-width:820px;">
      <h1 style="font-size:22px;margin:0 0 4px;">搜索「${escapeHtml(q)}」</h1>
      <p class="muted small" style="margin:0 0 16px;">共找到 ${results.length}${hasNext ? ' 条以上' : ' 条'}结果</p>

      <form class="row" data-search-form style="margin-bottom:18px;">
        <input class="input" name="q" type="search" value="${escapeHtml(q)}" placeholder="输入关键词" style="flex:1;">
        <button class="btn" type="submit">搜索</button>
      </form>

      <div class="tabs">
        ${TYPES.map((t) => `<a href="/search${buildQuery({ q, type: t.key, page: 1 })}" data-link class="${t.key === type ? 'active' : ''}">${t.label}</a>`).join('')}
      </div>

      <div class="card">
        ${results.length
          ? results.map(resultRow).join('')
          : emptyState('没有找到相关内容', '换个关键词试试，或减少筛选条件。', '<a class="btn" href="/forum" data-link>浏览论坛</a>')}
      </div>

      ${(hasPrev || hasNext) ? `
        <div class="pagination">
          <button type="button" data-page="${page - 1}" ${hasPrev ? '' : 'disabled'}>上一页</button>
          <span class="muted small" style="align-self:center;padding:0 10px;">第 ${page} 页</span>
          <button type="button" data-page="${page + 1}" ${hasNext ? '' : 'disabled'}>下一页</button>
        </div>` : ''}
    </div>`;

  ctx.el.querySelector('[data-search-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = e.target.q.value.trim();
    if (value) ctx.navigate(`/search${buildQuery({ q: value, type })}`);
    else ctx.navigate('/search');
  });

  ctx.el.querySelectorAll('.pagination button[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = Number(btn.dataset.page);
      if (!btn.disabled && p > 0) ctx.navigate(`/search${buildQuery({ q, type, page: p })}`);
    });
  });
}