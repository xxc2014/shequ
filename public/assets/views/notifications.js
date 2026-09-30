import { api, buildQuery } from '../api.js';
import { state, refreshUnread } from '../store.js';
import {
  escapeHtml, formatTime, avatarHtml, emptyState, paginationHtml, bindPagination, toast, setBusy
} from '../ui.js';

const TYPE_META = {
  reply: { icon: '💬', label: '回复' },
  mention: { icon: '📣', label: '提及' },
  like: { icon: '👍', label: '点赞' },
  blog: { icon: '📝', label: '博客' },
  system: { icon: '📢', label: '系统' }
};

function notifRow(n) {
  const meta = TYPE_META[n.type] || { icon: '🔔', label: '通知' };
  return `
    <div class="list-row ${n.isRead ? '' : 'unread'}" data-id="${n.id}">
      ${n.actor ? avatarHtml(n.actor) : `<span class="avatar" aria-hidden="true">${meta.icon}</span>`}
      <div style="flex:1;min-width:0;">
        <div class="row wrap" style="gap:8px;">
          <span class="pill gray">${meta.icon} ${meta.label}</span>
          <span class="tiny muted">${formatTime(n.createdAt)}</span>
          ${n.isRead ? '' : '<span class="pill primary" style="font-size:11px;">未读</span>'}
        </div>
        <div style="font-weight:600;margin-top:6px;">${escapeHtml(n.title || meta.label)}</div>
        ${n.body ? `<div class="small muted" style="margin-top:3px;">${escapeHtml(n.body)}</div>` : ''}
        <div class="row" style="gap:14px;margin-top:8px;">
          ${n.link ? `<a class="link-btn" href="${escapeHtml(n.link)}" data-link data-action="open">查看详情</a>` : ''}
          <button class="link-btn danger" type="button" data-action="delete">删除</button>
        </div>
      </div>
    </div>`;
}

export async function notificationsView(ctx) {
  const page = Math.max(1, Number(ctx.query.get('page') || 1) || 1);
  const onlyUnread = ctx.query.get('unread') === 'true';

  ctx.setTitle('通知');

  const data = await api.get(
    `/api/notifications${buildQuery({ page, pageSize: 20, unread: onlyUnread ? 'true' : '' })}`
  );
  const list = data.notifications || [];
  const pagination = data.pagination || {};

  ctx.el.innerHTML = `
    <div class="container" style="max-width:760px;">
      <div class="row between wrap" style="margin-bottom:14px;">
        <h1 style="font-size:22px;margin:0;">🔔 通知</h1>
        ${list.some((n) => !n.isRead) ? '<button class="btn ghost sm" data-action="read-all">全部标记已读</button>' : ''}
      </div>

      <div class="tabs">
        <a href="/notifications" data-link class="${onlyUnread ? '' : 'active'}">全部</a>
        <a href="/notifications?unread=true" data-link class="${onlyUnread ? 'active' : ''}">未读${state.unread ? ` (${state.unread > 99 ? '99+' : state.unread})` : ''}</a>
      </div>

      <div class="card">
        ${list.length
          ? list.map(notifRow).join('')
          : emptyState(onlyUnread ? '没有未读通知' : '暂无通知', '当有人回复、点赞或提及时，你会在这里看到消息。')}
      </div>

      ${paginationHtml(pagination)}
    </div>`;

  const link = (p) => `/notifications${buildQuery({ page: p, unread: onlyUnread ? 'true' : '' })}`;
  bindPagination(ctx.el, (p) => ctx.navigate(link(p)));

  ctx.el.querySelector('[data-action="read-all"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, '处理中…');
    try {
      await api.post('/api/notifications/read', {});
      await refreshUnread();
      toast('已全部标记为已读', 'success');
      ctx.navigate(link(page));
    } catch (err) {
      toast(err.message, 'error');
      setBusy(btn, false);
    }
  });

  ctx.el.querySelectorAll('.list-row[data-id]').forEach((row) => {
    const id = Number(row.dataset.id);

    row.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
      try {
        await api.del(`/api/notifications/${id}`);
        toast('通知已删除');
        ctx.navigate(link(page));
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    row.querySelector('[data-action="open"]')?.addEventListener('click', async () => {
      if (!row.classList.contains('unread')) return;
      try {
        await api.post('/api/notifications/read', { ids: [id] });
        await refreshUnread();
      } catch { /* 已读标记失败不影响跳转 */ }
    });
  });

  await refreshUnread();
}