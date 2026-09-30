import { loadSession, loadSite, state } from './store.js';
import { mountHeader } from './components/header.js';
import { qs, emptyState } from './ui.js';

import { homeView } from './views/home.js';
import { forumView } from './views/forum.js';
import { threadView } from './views/thread.js';
import { blogView } from './views/blog.js';
import { blogPostView } from './views/blog-post.js';
import { loginView, registerView } from './views/auth.js';
import { profileView } from './views/profile.js';
import { searchView } from './views/search.js';
import { notificationsView } from './views/notifications.js';
import { threadEditorView } from './views/thread-editor.js';
import { blogEditorView } from './views/blog-editor.js';
import { adminView } from './views/admin.js';

const routes = [
  { pattern: /^\/$/, view: homeView, title: '' },
  { pattern: /^\/forum$/, view: forumView, title: '论坛' },
  { pattern: /^\/new$/, view: threadEditorView, title: '发布新帖', auth: true },
  { pattern: /^\/t\/(\d+)$/, view: threadView, title: '帖子' },
  { pattern: /^\/blog$/, view: blogView, title: '官方博客' },
  { pattern: /^\/blog\/new$/, view: blogEditorView, title: '写文章', auth: true, staff: true },
  { pattern: /^\/blog\/(\d+)\/edit$/, view: blogEditorView, title: '编辑文章', auth: true, staff: true },
  { pattern: /^\/blog\/(.+)$/, view: blogPostView, title: '文章' },
  { pattern: /^\/login$/, view: loginView, title: '登录' },
  { pattern: /^\/register$/, view: registerView, title: '注册' },
  { pattern: /^\/u\/([^/]+)$/, view: profileView, title: '个人主页' },
  { pattern: /^\/search$/, view: searchView, title: '搜索' },
  { pattern: /^\/notifications$/, view: notificationsView, title: '通知', auth: true },
  { pattern: /^\/admin$/, view: adminView, title: '管理后台', auth: true, staff: true }
];

let currentCleanup = null;

export function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  render();
}

export function setTitle(text) {
  const siteName = (state.site && state.site.settings && state.site.settings.siteName) || 'DevHub';
  document.title = text ? `${text} · ${siteName}` : siteName;
}

function matchRoute(pathname) {
  for (const route of routes) {
    const m = pathname.match(route.pattern);
    if (m) return { route, params: m.slice(1).map(decodeURIComponent) };
  }
  return null;
}

export async function render() {
  const el = qs('#app');
  if (typeof currentCleanup === 'function') {
    try { currentCleanup(); } catch { /* ignore */ }
    currentCleanup = null;
  }

  const pathname = location.pathname;
  const matched = matchRoute(pathname);

  if (!matched) {
    setTitle('页面不存在');
    el.innerHTML = emptyState('404 · 页面不存在', '你访问的地址可能有误。', '<a class="btn" href="/" data-link>返回首页</a>');
    return;
  }

  const { route, params } = matched;
  if (route.auth && !state.user) {
    navigate(`/login?next=${encodeURIComponent(pathname)}`, { replace: true });
    return;
  }
  if (route.staff && !(state.user.role === 'admin' || state.user.role === 'moderator')) {
    setTitle('无权限');
    el.innerHTML = emptyState('无访问权限', '该页面仅对管理员与版主开放。', '<a class="btn" href="/" data-link>返回首页</a>');
    return;
  }

  setTitle('');
  el.innerHTML = '<div class="loading">加载中…</div>';

  const ctx = {
    el,
    params,
    navigate,
    setTitle,
    query: new URLSearchParams(location.search),
    cleanup: null
  };

  try {
    await route.view(ctx);
  } catch (err) {
    console.error(err);
    el.innerHTML = emptyState('加载失败', err.message || '请稍后重试。', '<button class="btn" onclick="location.reload()">重新加载</button>');
  }
  currentCleanup = ctx.cleanup;
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-link]');
  if (!link) return;
  const href = link.getAttribute('href');
  if (!href || href.startsWith('http') || href.startsWith('#')) return;
  event.preventDefault();
  navigate(href);
});

document.addEventListener('submit', (event) => {
  const form = event.target.closest('form[data-nav-search]');
  if (!form) return;
  event.preventDefault();
  const input = form.querySelector('input[name="q"]');
  const q = input ? input.value.trim() : '';
  if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
});

window.addEventListener('popstate', render);

async function boot() {
  mountHeader();
  await Promise.all([loadSite(), loadSession()]);
  render();
}

boot();