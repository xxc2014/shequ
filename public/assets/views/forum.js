import { api, buildQuery } from '../api.js';
import { state } from '../store.js';
import {
  escapeHtml, formatTime, avatarHtml, emptyState, tagsHtml, paginationHtml, bindPagination
} from '../ui.js';

const SORTS = [
  { key: 'latest', label: '最新' },
  { key: 'hot', label: '热门' },
  { key: 'top', label: '最高赞' }
];

function threadRow(thread) {
  return `
    <div class="thread-item">
      ${avatarHtml(thread.author)}
      <div class="thread-main">
        <a class="thread-title" href="/t/${thread.id}" data-link>
          ${thread.isPinned ? '<span class="pill primary" style="font-size:11px;">置顶</span>' : ''}
          ${thread.isLocked ? '<span class="pill gray" style="font-size:11px;">已锁定</span>' : ''}
          <span>${escapeHtml(thread.title)}</span>
        </a>
        <div class="thread-excerpt">${escapeHtml(thread.excerpt || '')}</div>
        <div class="thread-meta">
          <span>${escapeHtml(thread.category.icon || '')} ${escapeHtml(thread.category.name)}</span>
          <span>· ${escapeHtml(thread.author.displayName || thread.author.username)}</span>
          <span>· ${formatTime(thread.lastReplyAt || thread.createdAt)}</span>
          ${tagsHtml(thread.tags)}
        </div>
      </div>
      <div class="thread-stats">
        <span><span class="stat-num">${thread.replyCount}</span> 回复</span>
        <span><span class="stat-num">${thread.viewCount}</span> 浏览</span>
      </div>
    </div>`;
}

export async function forumView(ctx) {
  const category = ctx.query.get('category') || '';
  const tag = ctx.query.get('tag') || '';
  const sort = ctx.query.get('sort') || 'latest';
  const page = Number(ctx.query.get('page') || 1) || 1;

  const data = await api.get(`/api/threads${buildQuery({ category, tag, sort, page, pageSize: 20 })}`);
  const site = state.site || {};
  const activeCategory = (site.categories || []).find((c) => c.slug === category);

  ctx.setTitle(activeCategory ? activeCategory.name : '论坛');

  const heading = activeCategory
    ? `${escapeHtml(activeCategory.icon || '')} ${escapeHtml(activeCategory.name)}`
    : tag ? `#${escapeHtml(tag)}` : '全部讨论';

  ctx.el.innerHTML = `
    <div class="container">
      <div class="row between wrap" style="margin-bottom:16px;">
        <div>
          <h1 style="font-size:22px;margin:0;">${heading}</h1>
          ${activeCategory && activeCategory.description ? `<p class="muted small" style="margin:4px 0 0;">${escapeHtml(activeCategory.description)}</p>` : ''}
        </div>
        ${state.user ? '<a class="btn" href="/new" data-link>+ 发布新帖</a>' : '<a class="btn" href="/login" data-link>登录后发帖</a>'}
      </div>

      <div class="layout">
        <div>
          <div class="tabs">
            ${SORTS.map((s) => `<a href="/forum${buildQuery({ category, tag, sort: s.key })}" data-link class="${s.key === sort ? 'active' : ''}">${s.label}</a>`).join('')}
          </div>

          <div class="card">
            ${data.threads.length
              ? data.threads.map(threadRow).join('')
              : emptyState('暂无帖子', '换一个筛选条件，或发布第一个帖子。', state.user ? '<a class="btn" href="/new" data-link>发布新帖</a>' : '')}
          </div>
          ${paginationHtml(data.pagination)}
        </div>

        <aside class="stack">
          <div class="card card-pad">
            <h3 class="section-title" style="font-size:15px;">版块</h3>
            <div class="stack" style="gap:6px;">
              <a href="/forum" data-link class="row between ${!category ? 'active' : ''}" style="color:var(--text);">
                <span>全部版块</span>
              </a>
              ${(site.categories || []).map((c) => `
                <a href="/forum?category=${encodeURIComponent(c.slug)}" data-link class="row between" style="color:${c.slug === category ? 'var(--accent)' : 'var(--text)'};">
                  <span>${escapeHtml(c.icon || '')} ${escapeHtml(c.name)}</span>
                  <span class="tiny muted">${c.thread_count || 0}</span>
                </a>`).join('')}
            </div>
          </div>
          <div class="card card-pad">
            <h3 class="section-title" style="font-size:15px;">标签</h3>
            <div class="row wrap" style="gap:6px;">
              ${(site.tags || []).map((t) => `<a class="tag ${t.slug === tag ? 'primary' : ''}" href="/forum?tag=${encodeURIComponent(t.slug)}" data-link>#${escapeHtml(t.name)}</a>`).join('') || '<span class="muted small">暂无标签</span>'}
            </div>
          </div>
          <div class="card card-pad">
            <h3 class="section-title" style="font-size:15px;">社区规范</h3>
            <p class="small muted" style="margin:0;">友善交流、内容相关、拒绝广告、保护隐私。违规内容将被移除。</p>
          </div>
        </aside>
      </div>
    </div>`;

  bindPagination(ctx.el, (p) => ctx.navigate(`/forum${buildQuery({ category, tag, sort, page: p })}`));
}