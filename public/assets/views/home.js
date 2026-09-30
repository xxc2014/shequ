import { api } from '../api.js';
import { state } from '../store.js';
import { escapeHtml, formatTime, avatarHtml, emptyState, tagsHtml } from '../ui.js';

function postCardHtml(post) {
  const cover = post.coverImage
    ? `<div class="cover"><img src="${escapeHtml(post.coverImage)}" alt="" loading="lazy"></div>`
    : '<div class="cover" aria-hidden="true">📄</div>';
  return `
    <article class="card post-card">
      <a href="/blog/${encodeURIComponent(post.slug)}" data-link>${cover}</a>
      <div class="post-card-body">
        <div class="row wrap small muted" style="gap:8px;margin-bottom:6px;">
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

function threadRowHtml(thread, showTags = false) {
  return `
    <div class="thread-item">
      ${avatarHtml(thread.author)}
      <div class="thread-main">
        <a class="thread-title" href="/t/${thread.id}" data-link>
          <span>${escapeHtml(thread.category.icon || '')}</span>
          <span>${escapeHtml(thread.title)}</span>
        </a>
        <div class="thread-excerpt">${escapeHtml(thread.excerpt || '')}</div>
        <div class="thread-meta">
          <span>${escapeHtml(thread.category.name)}</span>
          <span>· ${escapeHtml(thread.author.displayName || thread.author.username)}</span>
          <span>· ${formatTime(thread.lastReplyAt || thread.createdAt)}</span>
          ${showTags ? tagsHtml(thread.tags) : ''}
        </div>
      </div>
      <div class="thread-stats">
        <span><span class="stat-num">${thread.replyCount}</span> 回复</span>
        <span><span class="stat-num">${thread.likeCount}</span> 赞</span>
      </div>
    </div>`;
}

export async function homeView(ctx) {
  const data = await api.get('/api/home');
  const settings = (state.site && state.site.settings) || {};
  const siteName = settings.siteName || 'DevHub';
  const description = settings.siteDescription || '面向开发者的技术交流社区与官方博客';

  const stats = data.stats || {};
  const announcement = settings.announcement;

  ctx.setTitle('');
  ctx.el.innerHTML = `
    <div class="container">
      <section class="hero">
        <h1>${escapeHtml(siteName)}</h1>
        <p>${escapeHtml(description)}</p>
        <div class="row wrap">
          <a class="btn" href="${state.user ? '/new' : '/register'}" data-link>${state.user ? '发布新帖' : '加入社区'}</a>
          <a class="btn secondary" href="/forum" data-link>浏览讨论</a>
          <a class="btn secondary" href="/blog" data-link>阅读博客</a>
        </div>
        <div class="stat-grid" style="margin-top:26px;color:#fff;">
          <div class="stat-box" style="background:rgba(255,255,255,.16);color:#fff;">
            <div class="num">${stats.users || 0}</div><div class="lbl" style="color:rgba(255,255,255,.85);">注册用户</div>
          </div>
          <div class="stat-box" style="background:rgba(255,255,255,.16);color:#fff;">
            <div class="num">${stats.threads || 0}</div><div class="lbl" style="color:rgba(255,255,255,.85);">主题帖</div>
          </div>
          <div class="stat-box" style="background:rgba(255,255,255,.16);color:#fff;">
            <div class="num">${stats.replies || 0}</div><div class="lbl" style="color:rgba(255,255,255,.85);">回复</div>
          </div>
          <div class="stat-box" style="background:rgba(255,255,255,.16);color:#fff;">
            <div class="num">${stats.posts || 0}</div><div class="lbl" style="color:rgba(255,255,255,.85);">博客文章</div>
          </div>
        </div>
      </section>

      ${announcement ? `<div class="card card-pad" style="margin-bottom:24px;border-left:3px solid var(--accent);"><strong>📢 公告：</strong>${escapeHtml(announcement)}</div>` : ''}

      ${data.featuredPosts.length ? `
        <section style="margin-bottom:32px;">
          <h2 class="section-title">精选文章 <a class="more" href="/blog" data-link>查看全部 →</a></h2>
          <div class="blog-grid">${data.featuredPosts.map(postCardHtml).join('')}</div>
        </section>` : ''}

      <div class="layout">
        <div>
          <section class="card">
            <div class="card-pad" style="padding-bottom:0;">
              <h2 class="section-title">最新讨论 <a class="more" href="/forum" data-link>进入论坛 →</a></h2>
            </div>
            <div>
              ${data.latestThreads.length
                ? data.latestThreads.map((t) => threadRowHtml(t)).join('')
                : emptyState('还没有讨论', '成为第一个发帖的人吧。', state.user ? '<a class="btn" href="/new" data-link>发布新帖</a>' : '<a class="btn" href="/login" data-link>登录后发帖</a>')}
            </div>
          </section>

          ${data.latestPosts.length ? `
            <section style="margin-top:24px;">
              <h2 class="section-title">最新文章</h2>
              <div class="blog-grid">${data.latestPosts.slice(0, 3).map(postCardHtml).join('')}</div>
            </section>` : ''}
        </div>

        <aside class="stack">
          <div class="card card-pad">
            <h3 class="section-title" style="font-size:15px;">🔥 热门讨论</h3>
            <div class="stack" style="gap:12px;">
              ${data.hotThreads.length
                ? data.hotThreads.map((t) => `
                  <div>
                    <a href="/t/${t.id}" data-link style="font-weight:600;font-size:14px;">${escapeHtml(t.title)}</a>
                    <div class="tiny muted" style="margin-top:3px;">${t.replyCount} 回复 · ${t.likeCount} 赞 · ${escapeHtml(t.category.name)}</div>
                  </div>`).join('')
                : '<span class="muted small">暂无数据</span>'}
            </div>
          </div>

          <div class="card card-pad">
            <h3 class="section-title" style="font-size:15px;">版块</h3>
            <div class="stack" style="gap:8px;">
              ${((state.site && state.site.categories) || []).map((c) => `
                <a href="/forum?category=${encodeURIComponent(c.slug)}" data-link class="row between" style="color:var(--text);">
                  <span>${escapeHtml(c.icon || '')} ${escapeHtml(c.name)}</span>
                  <span class="tiny muted">${c.thread_count || c.threadCount || 0}</span>
                </a>`).join('') || '<span class="muted small">暂无版块</span>'}
            </div>
          </div>

          <div class="card card-pad">
            <h3 class="section-title" style="font-size:15px;">热门标签</h3>
            <div class="row wrap" style="gap:6px;">
              ${((state.site && state.site.tags) || []).map((t) => `<a class="tag" href="/forum?tag=${encodeURIComponent(t.slug)}" data-link>#${escapeHtml(t.name)}</a>`).join('') || '<span class="muted small">暂无标签</span>'}
            </div>
          </div>
        </aside>
      </div>
    </div>`;
}