import { api, buildQuery } from '../api.js';
import { state, isStaff } from '../store.js';
import { escapeHtml, formatTime, avatarHtml, emptyState, paginationHtml, bindPagination } from '../ui.js';

function postCard(post) {
  const cover = post.coverImage
    ? `<div class="cover"><img src="${escapeHtml(post.coverImage)}" alt="" loading="lazy"></div>`
    : '<div class="cover" aria-hidden="true">📄</div>';
  return `
    <article class="card post-card">
      <a href="/blog/${encodeURIComponent(post.slug)}" data-link>${cover}</a>
      <div class="post-card-body">
        <div class="row wrap small muted" style="gap:8px;margin-bottom:6px;">
          ${post.featured ? '<span class="pill primary">精选</span>' : ''}
          ${post.status === 'draft' ? '<span class="pill gray">草稿</span>' : ''}
          ${post.category ? `<span class="tag primary">${escapeHtml(post.category.name)}</span>` : ''}
          <span>${formatTime(post.publishedAt)}</span>
        </div>
        <h3><a href="/blog/${encodeURIComponent(post.slug)}" data-link>${escapeHtml(post.title)}</a></h3>
        <p class="excerpt">${escapeHtml(post.summary || '')}</p>
        <div class="row small muted" style="margin-top:12px;">
          ${avatarHtml(post.author, 'sm')}
          <span>${escapeHtml(post.author.displayName || post.author.username)}</span>
          <span style="margin-left:auto;">👁 ${post.viewCount || 0} · 👍 ${post.likeCount || 0}</span>
        </div>
      </div>
    </article>`;
}

export async function blogView(ctx) {
  const category = ctx.query.get('category') || '';
  const tag = ctx.query.get('tag') || '';
  const page = Number(ctx.query.get('page') || 1) || 1;
  const showAll = ctx.query.get('status') === 'all' && isStaff();

  const [data, categoriesData] = await Promise.all([
    api.get(`/api/blog${buildQuery({ category, tag, page, pageSize: 12, status: showAll ? 'all' : '' })}`),
    api.get('/api/blog/categories')
  ]);

  const categories = categoriesData.categories || [];
  const active = categories.find((c) => c.slug === category);
  ctx.setTitle(active ? active.name : '官方博客');

  ctx.el.innerHTML = `
    <div class="container">
      <div class="row between wrap" style="margin-bottom:18px;">
        <div>
          <h1 style="font-size:24px;margin:0;">📰 官方博客</h1>
          <p class="muted small" style="margin:4px 0 0;">产品动态、工程实践与教程指南</p>
        </div>
        <div class="row">
          ${isStaff() ? '<a class="btn secondary" href="/blog?status=all" data-link>含草稿</a>' : ''}
          ${isStaff() ? '<a class="btn" href="/blog/new" data-link>+ 写文章</a>' : ''}
        </div>
      </div>

      <div class="tabs">
        <a href="/blog" data-link class="${!category ? 'active' : ''}">全部</a>
        ${categories.map((c) => `<a href="/blog?category=${encodeURIComponent(c.slug)}" data-link class="${c.slug === category ? 'active' : ''}">${escapeHtml(c.name)} <span class="tiny muted">${c.postCount}</span></a>`).join('')}
        ${tag ? `<a class="active" href="/blog?tag=${encodeURIComponent(tag)}" data-link>#${escapeHtml(tag)}</a>` : ''}
      </div>

      ${data.posts.length
        ? `<div class="blog-grid">${data.posts.map(postCard).join('')}</div>`
        : emptyState('暂无文章', category || tag ? '该分类下还没有文章。' : '敬请期待官方内容更新。')}
      ${paginationHtml(data.pagination)}
    </div>`;

  bindPagination(ctx.el, (p) => ctx.navigate(`/blog${buildQuery({ category, tag, page: p, status: showAll ? 'all' : '' })}`));
}