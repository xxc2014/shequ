import { api } from '../api.js';
import { state, isStaff } from '../store.js';
import { renderMarkdown } from '../md.js';
import { escapeHtml, formatTime, avatarHtml, tagsHtml, toast, emptyState } from '../ui.js';

export async function blogPostView(ctx) {
  const slug = ctx.params[0];
  let data;
  try {
    data = await api.get(`/api/blog/${encodeURIComponent(slug)}`);
  } catch (err) {
    ctx.setTitle('文章不存在');
    ctx.el.innerHTML = `<div class="container">${emptyState('文章不存在', '该文章可能已被删除或尚未发布。', '<a class="btn" href="/blog" data-link>返回博客</a>')}</div>`;
    return;
  }

  const post = data.post;
  const user = state.user;
  const canEdit = user && (user.id === post.author.id || isStaff(user));
  const readMinutes = Math.max(1, Math.round((post.body || '').length / 400));

  ctx.setTitle(post.title);

  ctx.el.innerHTML = `
    <div class="container" style="max-width:820px;">
      <article class="card">
        <div class="card-pad">
          <div class="row wrap small muted" style="gap:10px;margin-bottom:10px;">
            <a href="/blog" data-link>博客</a>
            ${post.category ? `<span>/</span><a href="/blog?category=${encodeURIComponent(post.category.slug)}" data-link>${escapeHtml(post.category.name)}</a>` : ''}
            ${post.status === 'draft' ? '<span class="pill gray">草稿（仅你可见）</span>' : ''}
            ${post.featured ? '<span class="pill primary">精选</span>' : ''}
          </div>
          <h1 style="font-size:30px;line-height:1.3;margin:0 0 14px;">${escapeHtml(post.title)}</h1>
          <div class="row wrap" style="gap:10px;">
            ${avatarHtml(post.author)}
            <div>
              <div style="font-weight:600;">${escapeHtml(post.author.displayName || post.author.username)}</div>
              <div class="tiny muted">${formatTime(post.publishedAt || post.createdAt)} · 约 ${readMinutes} 分钟阅读 · 👁 ${post.viewCount}</div>
            </div>
            <div class="row" style="margin-left:auto;">
              <button class="btn sm ${post.liked ? 'liked' : 'secondary'}" data-action="like">
                👍 <span id="like-count">${post.likeCount}</span>
              </button>
            </div>
          </div>
        </div>

        ${post.coverImage ? `<img src="${escapeHtml(post.coverImage)}" alt="" style="width:100%;max-height:420px;object-fit:cover;">` : ''}

        <div class="card-pad">
          <div class="prose">${renderMarkdown(post.body)}</div>
          ${post.tags && post.tags.length ? `<div class="row wrap" style="gap:6px;margin-top:26px;">${tagsHtml(post.tags, '/blog')}</div>` : ''}
        </div>

        ${canEdit ? `
          <div class="card-pad" style="border-top:1px solid var(--border);">
            <a class="btn sm secondary" href="/blog/${post.id}/edit" data-link>编辑文章</a>
            <button class="btn sm danger" data-action="delete">删除文章</button>
          </div>` : ''}
      </article>

      <div class="row between" style="margin-top:20px;">
        <a class="btn secondary" href="/blog" data-link>← 返回博客列表</a>
        <a class="btn ghost" href="/feed.xml">订阅 RSS</a>
      </div>
    </div>`;

  ctx.el.querySelector('[data-action="like"]')?.addEventListener('click', async (e) => {
    if (!state.user) return ctx.navigate('/login');
    const btn = e.currentTarget;
    try {
      const res = await api.post('/api/likes', { targetType: 'post', targetId: post.id });
      btn.classList.toggle('liked', res.liked);
      ctx.el.querySelector('#like-count').textContent = res.likeCount;
    } catch (err) { toast(err.message, 'error'); }
  });

  ctx.el.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    if (!confirm('确定删除这篇文章？')) return;
    try { await api.del(`/api/blog/${post.id}`); toast('文章已删除'); ctx.navigate('/blog'); }
    catch (err) { toast(err.message, 'error'); }
  });
}