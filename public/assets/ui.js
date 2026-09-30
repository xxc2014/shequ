import { escapeHtml } from './md.js';

export { escapeHtml };

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

// 时间格式化：1 分钟内显示“刚刚”，7 天内相对时间，否则绝对日期
export function formatTime(seconds) {
  if (!seconds) return '';
  const date = new Date(seconds * 1000);
  const diff = Math.floor(Date.now() / 1000) - seconds;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDate(seconds) {
  if (!seconds) return '';
  const date = new Date(seconds * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function avatarHtml(user, size = '') {
  if (!user) return `<span class="avatar ${size}">?</span>`;
  const name = user.displayName || user.username || '?';
  const initial = escapeHtml(String(name).slice(0, 1).toUpperCase());
  if (user.avatarUrl) {
    return `<span class="avatar ${size}"><img src="${escapeHtml(user.avatarUrl)}" alt="${escapeHtml(name)}" loading="lazy"></span>`;
  }
  return `<span class="avatar ${size}" aria-hidden="true">${initial}</span>`;
}

export function roleBadge(role) {
  if (role === 'admin') return '<span class="pill red">管理员</span>';
  if (role === 'moderator') return '<span class="pill amber">版主</span>';
  return '';
}

export function tagsHtml(tags, base = '/forum') {
  if (!tags || !tags.length) return '';
  return tags.map((t) => `<a class="tag" href="${base}?tag=${encodeURIComponent(t.slug)}" data-link>#${escapeHtml(t.name)}</a>`).join(' ');
}

export function paginationHtml(pagination) {
  if (!pagination || !pagination.totalPages || pagination.totalPages <= 1) return '';
  const { page, totalPages } = pagination;
  const pages = [];
  const push = (p) => pages.push(
    `<button type="button" data-page="${p}" class="${p === page ? 'active' : ''}">${p}</button>`
  );
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);

  const out = [];
  out.push(`<button type="button" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>`);
  if (start > 1) { push(1); if (start > 2) out.push('<span class="muted">…</span>'); }
  for (let p = start; p <= end; p++) push(p);
  if (end < totalPages) { if (end < totalPages - 1) out.push('<span class="muted">…</span>'); push(totalPages); }
  out.push(`<button type="button" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>下一页</button>`);
  return `<div class="pagination">${out.join('')}${pages.join('')}</div>`;
}

// 绑定分页点击
export function bindPagination(root, onPage) {
  qsa('.pagination button[data-page]', root).forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = Number(btn.dataset.page);
      if (!btn.disabled && page > 0) onPage(page);
    });
  });
}

export function toast(message, type = 'info') {
  const root = qs('#toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

export function setBusy(button, busy, label = '处理中…') {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

export function showFormError(container, message) {
  const el = qs('.form-error', container);
  if (el) el.textContent = message || '';
}

export function emptyState(title, description = '', actionHtml = '') {
  return `<div class="empty"><h3>${escapeHtml(title)}</h3>${description ? `<p class="muted">${escapeHtml(description)}</p>` : ''}${actionHtml}</div>`;
}

export function statusBadge(status) {
  const map = {
    published: '<span class="pill green">已发布</span>',
    draft: '<span class="pill gray">草稿</span>',
    hidden: '<span class="pill amber">已隐藏</span>',
    deleted: '<span class="pill red">已删除</span>',
    open: '<span class="pill amber">待处理</span>',
    resolved: '<span class="pill green">已处理</span>',
    dismissed: '<span class="pill gray">已驳回</span>',
    active: '<span class="pill green">正常</span>',
    banned: '<span class="pill red">已封禁</span>'
  };
  return map[status] || `<span class="pill gray">${escapeHtml(status)}</span>`;
}