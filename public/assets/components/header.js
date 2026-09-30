import { api } from '../api.js';
import { state, subscribe, setState } from '../store.js';
import { qs, avatarHtml, roleBadge, toast } from '../ui.js';

function navLink(href, label, current) {
  const active = current === href || (href !== '/' && current.startsWith(href)) ? 'active' : '';
  return `<a href="${href}" data-link class="${active}">${label}</a>`;
}

function render() {
  const header = qs('#site-header');
  if (!header) return;
  const siteName = (state.site && state.site.settings && state.site.settings.siteName) || 'DevHub';
  const current = location.pathname;
  const user = state.user;

  const brandMark = siteName.slice(0, 1).toUpperCase();

  let actions = '';
  if (user) {
    actions = `
      <a class="icon-btn" href="/notifications" data-link title="通知" aria-label="通知">
        <span aria-hidden="true">🔔</span>
        ${state.unread > 0 ? `<span class="badge-dot">${state.unread > 99 ? '99+' : state.unread}</span>` : ''}
      </a>
      <div class="user-menu" id="user-menu">
        <button type="button" class="icon-btn" id="user-menu-toggle" aria-haspopup="true" aria-expanded="false">
          ${avatarHtml(user)}
        </button>
        <div class="dropdown" role="menu">
          <div style="padding:8px 12px;">
            <div style="font-weight:600;">${user.displayName || user.username}</div>
            <div class="tiny muted">@${user.username} ${roleBadge(user.role)}</div>
          </div>
          <hr>
          <a href="/u/${encodeURIComponent(user.username)}" data-link>个人主页</a>
          <a href="/new" data-link>发布新帖</a>
          ${user.role === 'admin' || user.role === 'moderator' ? '<a href="/blog/new" data-link>写文章</a>' : ''}
          ${user.role === 'admin' || user.role === 'moderator' ? '<a href="/admin" data-link>管理后台</a>' : ''}
          <hr>
          <button type="button" id="logout-btn">退出登录</button>
        </div>
      </div>`;
  } else {
    actions = `
      <a class="btn ghost sm" href="/login" data-link>登录</a>
      <a class="btn sm" href="/register" data-link>注册</a>`;
  }

  header.innerHTML = `
    <div class="container header-inner">
      <a class="brand" href="/" data-link>
        <span class="brand-mark">${brandMark}</span>
        <span>${siteName}</span>
      </a>
      <nav class="nav">
        ${navLink('/', '首页', current)}
        ${navLink('/forum', '论坛', current)}
        ${navLink('/blog', '博客', current)}
      </nav>
      <div class="header-spacer"></div>
      <form class="search-mini" data-nav-search role="search">
        <input type="search" name="q" placeholder="搜索帖子 / 文章" aria-label="搜索"
               value="${current === '/search' ? (new URLSearchParams(location.search).get('q') || '') : ''}">
      </form>
      <div class="header-actions">${actions}</div>
    </div>`;

  const menu = qs('#user-menu', header);
  const toggle = qs('#user-menu-toggle', header);
  if (toggle) {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
      toggle.setAttribute('aria-expanded', menu.classList.contains('open') ? 'true' : 'false');
    });
    document.addEventListener('click', () => menu.classList.remove('open'));
  }

  const logoutBtn = qs('#logout-btn', header);
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await api.post('/api/auth/logout', {});
        setState({ user: null, unread: 0 });
        toast('已退出登录');
        location.href = '/';
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }
}

export function mountHeader() {
  render();
  subscribe(render);
}