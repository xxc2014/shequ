import { api, buildQuery } from '../api.js';
import { state, isAdmin, loadSite } from '../store.js';
import {
  escapeHtml, formatDate, formatTime, roleBadge, statusBadge,
  emptyState, paginationHtml, bindPagination, toast, setBusy
} from '../ui.js';

const TABS = [
  { key: 'overview', label: '概览', adminOnly: false },
  { key: 'reports', label: '举报处理', adminOnly: false },
  { key: 'audit', label: '审计日志', adminOnly: false },
  { key: 'users', label: '用户管理', adminOnly: true },
  { key: 'categories', label: '版块管理', adminOnly: true },
  { key: 'settings', label: '站点设置', adminOnly: true },
  { key: 'broadcast', label: '全站通知', adminOnly: true }
];

const ROLE_LABEL = { member: '成员', moderator: '版主', admin: '管理员' };
const REPORT_LABEL = { thread: '帖子', reply: '回复', user: '用户', post: '文章' };

function targetLink(r) {
  if (r.target_type === 'thread') return `<a href="/t/${r.target_id}" data-link>帖子 #${r.target_id}</a>`;
  if (r.target_type === 'post') return `<a href="/blog/${r.target_id}" data-link>文章 #${r.target_id}</a>`;
  return `<span>${REPORT_LABEL[r.target_type] || r.target_type} #${r.target_id}</span>`;
}

export async function adminView(ctx) {
  const admin = isAdmin();
  const allowed = TABS.filter((t) => !t.adminOnly || admin);
  let tab = ctx.query.get('tab') || 'overview';
  if (!allowed.some((t) => t.key === tab)) tab = 'overview';

  ctx.setTitle('管理后台');

  ctx.el.innerHTML = `
    <div class="container">
      <h1 style="font-size:22px;margin:0 0 18px;">⚙️ 管理后台</h1>
      <div class="admin-layout">
        <nav class="admin-nav card card-pad" style="padding:10px;">
          ${allowed.map((t) => `<a href="/admin${buildQuery({ tab: t.key })}" data-link class="${t.key === tab ? 'active' : ''}">${t.label}</a>`).join('')}
        </nav>
        <div id="admin-panel"><div class="loading">加载中…</div></div>
      </div>
    </div>`;

  const panel = ctx.el.querySelector('#admin-panel');
  const renderers = { overview, reports, audit, users, categories, settings, broadcast };
  try {
    await renderers[tab](ctx, panel);
  } catch (err) {
    panel.innerHTML = emptyState('加载失败', err.message, '<button class="btn" type="button" onclick="location.reload()">重新加载</button>');
  }
}

// ============ 概览 ============
async function overview(ctx, panel) {
  const data = await api.get('/api/admin/stats');
  const s = data.stats || {};
  const cards = [
    { label: '注册用户', value: s.users, sub: `近 7 天 +${s.new_users_7d || 0}` },
    { label: '主题帖', value: s.threads },
    { label: '回复', value: s.replies },
    { label: '已发布文章', value: s.posts, sub: `草稿 ${s.drafts || 0}` },
    { label: '待处理举报', value: s.open_reports }
  ];

  panel.innerHTML = `
    <div class="stat-grid" style="margin-bottom:20px;">
      ${cards.map((c) => `
        <div class="stat-box">
          <div class="num">${c.value ?? 0}</div>
          <div class="lbl">${c.label}</div>
          ${c.sub ? `<div class="tiny muted" style="margin-top:4px;">${c.sub}</div>` : ''}
        </div>`).join('')}
    </div>

    <div class="card card-pad">
      <h3 class="section-title" style="font-size:15px;">最近注册</h3>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>用户</th><th>邮箱</th><th>角色</th><th>状态</th><th>注册时间</th></tr></thead>
          <tbody>
            ${(data.recentUsers || []).map((u) => `
              <tr>
                <td><a href="/u/${encodeURIComponent(u.username)}" data-link>${escapeHtml(u.username)}</a></td>
                <td class="muted tiny">${escapeHtml(u.email || '')}</td>
                <td>${roleBadge(u.role) || '<span class="muted">成员</span>'}</td>
                <td>${statusBadge(u.status)}</td>
                <td class="muted tiny">${formatDate(u.created_at)}</td>
              </tr>`).join('') || '<tr><td colspan="5" class="muted">暂无数据</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ============ 举报处理 ============
async function reports(ctx, panel) {
  const status = ctx.query.get('status') || 'open';
  const page = Math.max(1, Number(ctx.query.get('page') || 1) || 1);
  const data = await api.get(`/api/admin/reports${buildQuery({ status, page })}`);
  const list = data.reports || [];
  const filters = [
    { key: 'open', label: '待处理' },
    { key: 'resolved', label: '已处理' },
    { key: 'dismissed', label: '已驳回' },
    { key: 'all', label: '全部' }
  ];

  panel.innerHTML = `
    <div class="card">
      <div class="card-pad" style="padding-bottom:6px;">
        <div class="tabs" style="margin:0;">
          ${filters.map((f) => `<a href="/admin${buildQuery({ tab: 'reports', status: f.key, page: 1 })}" data-link class="${f.key === status ? 'active' : ''}">${f.label}</a>`).join('')}
        </div>
      </div>
      <div class="card-pad" style="padding-top:0;">
        ${list.length ? list.map((r) => `
          <div class="list-row" data-report="${r.id}">
            <span class="pill ${r.status === 'open' ? 'amber' : r.status === 'resolved' ? 'green' : 'gray'}">${r.status === 'open' ? '待处理' : r.status === 'resolved' ? '已处理' : '已驳回'}</span>
            <div style="flex:1;min-width:0;">
              <div class="row wrap" style="gap:8px;">
                <span class="small">目标：${targetLink(r)}</span>
                <span class="tiny muted">· 举报人 @${escapeHtml(r.reporter_username || '')}</span>
                <span class="tiny muted">· ${formatTime(r.created_at)}</span>
              </div>
              <div style="margin-top:6px;"><strong>${escapeHtml(r.reason)}</strong></div>
              ${r.detail ? `<div class="small muted" style="margin-top:3px;">${escapeHtml(r.detail)}</div>` : ''}
              ${r.status === 'open' ? `
                <div class="row" style="gap:10px;margin-top:9px;">
                  <button class="btn sm" type="button" data-action="resolve">标记已处理</button>
                  <button class="btn ghost sm" type="button" data-action="dismiss">驳回</button>
                </div>` : ''}
            </div>
          </div>`).join('') : emptyState('暂无举报', '当前没有需要处理的举报。')}
      </div>
    </div>
    ${paginationHtml(data.pagination)}`;

  bindPagination(panel, (p) => ctx.navigate(`/admin${buildQuery({ tab: 'reports', status, page: p })}`));

  panel.querySelectorAll('[data-report]').forEach((row) => {
    const id = Number(row.dataset.report);
    const update = async (next) => {
      try {
        await api.patch(`/api/admin/reports/${id}`, { status: next });
        toast('举报已处理', 'success');
        ctx.navigate(`/admin${buildQuery({ tab: 'reports', status, page })}`);
      } catch (err) { toast(err.message, 'error'); }
    };
    row.querySelector('[data-action="resolve"]')?.addEventListener('click', () => update('resolved'));
    row.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => update('dismissed'));
  });
}

// ============ 审计日志 ============
async function audit(ctx, panel) {
  const page = Math.max(1, Number(ctx.query.get('page') || 1) || 1);
  const data = await api.get(`/api/admin/audit${buildQuery({ page })}`);

  panel.innerHTML = `
    <div class="card">
      <div class="card-pad" style="padding-bottom:6px;">
        <h3 class="section-title" style="font-size:16px;margin:0;">审计日志</h3>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>目标</th><th>详情</th></tr></thead>
          <tbody>
            ${(data.logs || []).map((l) => `
              <tr>
                <td class="muted tiny">${formatDate(l.created_at)}</td>
                <td>${escapeHtml(l.actor_username || '系统')}</td>
                <td><code>${escapeHtml(l.action)}</code></td>
                <td class="muted tiny">${escapeHtml(l.target_type || '')}${l.target_id ? ` #${l.target_id}` : ''}</td>
                <td class="muted tiny" style="max-width:280px;overflow-wrap:anywhere;">${escapeHtml(l.meta || '')}</td>
              </tr>`).join('') || '<tr><td colspan="5" class="muted">暂无日志</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    ${paginationHtml(data.pagination)}`;

  bindPagination(panel, (p) => ctx.navigate(`/admin${buildQuery({ tab: 'audit', page: p })}`));
}

// ============ 用户管理（管理员） ============
async function users(ctx, panel) {
  const q = ctx.query.get('q') || '';
  const role = ctx.query.get('role') || '';
  const page = Math.max(1, Number(ctx.query.get('page') || 1) || 1);
  const data = await api.get(`/api/admin/users${buildQuery({ q, role, page })}`);
  const list = data.users || [];

  panel.innerHTML = `
    <div class="card">
      <div class="card-pad">
        <form class="row wrap" data-user-search>
          <input class="input" name="q" value="${escapeHtml(q)}" placeholder="搜索用户名或邮箱" style="flex:1;min-width:180px;">
          <select class="select" name="role" style="width:130px;">
            <option value="">全部角色</option>
            <option value="member" ${role === 'member' ? 'selected' : ''}>成员</option>
            <option value="moderator" ${role === 'moderator' ? 'selected' : ''}>版主</option>
            <option value="admin" ${role === 'admin' ? 'selected' : ''}>管理员</option>
          </select>
          <button class="btn" type="submit">筛选</button>
        </form>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>用户</th><th>邮箱</th><th>角色</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            ${list.map((u) => {
              const self = state.user && state.user.id === u.id;
              return `
                <tr data-user="${u.id}">
                  <td>
                    <a href="/u/${encodeURIComponent(u.username)}" data-link>${escapeHtml(u.username)}</a>
                    <div class="tiny muted">${escapeHtml(u.displayName || '')}</div>
                  </td>
                  <td class="muted tiny">${escapeHtml(u.email || '')}</td>
                  <td>
                    <select class="select" data-field="role" ${self ? 'disabled' : ''} style="width:112px;">
                      ${['member', 'moderator', 'admin'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}
                    </select>
                  </td>
                  <td>
                    <select class="select" data-field="status" style="width:100px;">
                      <option value="active" ${u.status === 'active' ? 'selected' : ''}>正常</option>
                      <option value="banned" ${u.status === 'banned' ? 'selected' : ''}>封禁</option>
                    </select>
                  </td>
                  <td>
                    ${self ? '<span class="tiny muted">当前账号</span>' : '<button class="btn sm" type="button" data-action="save-user">保存</button>'}
                  </td>
                </tr>`;
            }).join('') || '<tr><td colspan="5" class="muted">没有匹配的用户</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    ${paginationHtml(data.pagination)}`;

  bindPagination(panel, (p) => ctx.navigate(`/admin${buildQuery({ tab: 'users', q, role, page: p })}`));

  const searchForm = panel.querySelector('[data-user-search]');
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    ctx.navigate(`/admin${buildQuery({ tab: 'users', q: searchForm.q.value.trim(), role: searchForm.role.value, page: 1 })}`);
  });

  panel.querySelectorAll('[data-user]').forEach((row) => {
    const id = Number(row.dataset.user);
    row.querySelector('[data-action="save-user"]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      setBusy(btn, true, '…');
      try {
        await api.patch(`/api/admin/users/${id}`, {
          role: row.querySelector('[data-field="role"]').value,
          status: row.querySelector('[data-field="status"]').value
        });
        toast('用户已更新', 'success');
        setBusy(btn, false);
      } catch (err) {
        toast(err.message, 'error');
        setBusy(btn, false);
      }
    });
  });
}

// ============ 版块管理（管理员） ============
async function categories(ctx, panel) {
  const data = await api.get('/api/categories');
  const list = data.categories || [];

  panel.innerHTML = `
    <div class="card">
      <div class="card-pad" style="padding-bottom:6px;">
        <div class="row between wrap">
          <h3 class="section-title" style="font-size:16px;margin:0;">版块管理</h3>
          <button class="btn sm" type="button" data-action="new-category">+ 新建版块</button>
        </div>
      </div>
      <div class="card-pad" style="padding-top:8px;">
        <div id="category-form"></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>图标</th><th>名称</th><th>标识</th><th>帖子</th><th>操作</th></tr></thead>
            <tbody>
              ${list.map((c) => `
                <tr data-category="${c.id}">
                  <td>${escapeHtml(c.icon || '—')}</td>
                  <td>${escapeHtml(c.name)}<div class="tiny muted">${escapeHtml(c.description || '')}</div></td>
                  <td class="muted tiny">${escapeHtml(c.slug)}</td>
                  <td>${c.threadCount || 0}</td>
                  <td class="row" style="gap:12px;">
                    <button class="link-btn" type="button" data-action="edit-category">编辑</button>
                    <button class="link-btn danger" type="button" data-action="delete-category">删除</button>
                  </td>
                </tr>`).join('') || '<tr><td colspan="5" class="muted">暂无版块</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;

  const reload = () => ctx.navigate(`/admin${buildQuery({ tab: 'categories' })}`);
  panel.querySelector('[data-action="new-category"]').addEventListener('click', () => openCategoryForm(ctx, panel, null, reload));
  panel.querySelectorAll('[data-category]').forEach((row) => {
    const category = list.find((c) => c.id === Number(row.dataset.category));
    row.querySelector('[data-action="edit-category"]')?.addEventListener('click', () => openCategoryForm(ctx, panel, category, reload));
    row.querySelector('[data-action="delete-category"]')?.addEventListener('click', async () => {
      if (!confirm(`确定删除版块「${category.name}」？`)) return;
      try {
        await api.del(`/api/admin/categories/${category.id}`);
        toast('版块已删除', 'success');
        reload();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

function openCategoryForm(ctx, panel, category, reload) {
  const target = panel.querySelector('#category-form');
  target.innerHTML = `
    <div class="card card-pad" style="background:var(--surface-2);margin-bottom:14px;">
      <div class="form-error"></div>
      <form data-category-form>
        <div class="row wrap" style="gap:14px;align-items:flex-start;">
          <div class="field" style="flex:2;min-width:180px;">
            <label>名称</label>
            <input class="input" name="name" maxlength="40" required value="${category ? escapeHtml(category.name) : ''}">
          </div>
          <div class="field" style="flex:1;min-width:120px;">
            <label>图标</label>
            <input class="input" name="icon" maxlength="8" value="${category ? escapeHtml(category.icon || '') : ''}" placeholder="💬">
          </div>
          <div class="field" style="flex:1;min-width:120px;">
            <label>标识</label>
            <input class="input" name="slug" maxlength="50" value="${category ? escapeHtml(category.slug) : ''}" ${category ? 'disabled' : ''} placeholder="自动生成">
          </div>
        </div>
        <div class="field">
          <label>描述</label>
          <input class="input" name="description" maxlength="200" value="${category ? escapeHtml(category.description || '') : ''}">
        </div>
        <div class="row">
          <button class="btn sm" type="submit">${category ? '保存' : '创建'}</button>
          <button class="btn ghost sm" type="button" data-action="cancel">取消</button>
        </div>
      </form>
    </div>`;

  const form = target.querySelector('form');
  const nameEl = form.querySelector('[name="name"]');
  const iconEl = form.querySelector('[name="icon"]');
  const slugEl = form.querySelector('[name="slug"]');
  const descEl = form.querySelector('[name="description"]');
  target.querySelector('[data-action="cancel"]').addEventListener('click', () => { target.innerHTML = ''; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    setBusy(submit, true, '保存中…');
    const payload = {
      name: nameEl.value.trim(),
      icon: iconEl.value.trim(),
      description: descEl.value.trim(),
      ...(category ? {} : { slug: slugEl.value.trim() })
    };
    try {
      if (category) await api.patch(`/api/admin/categories/${category.id}`, payload);
      else await api.post('/api/admin/categories', payload);
      toast(category ? '版块已更新' : '版块已创建', 'success');
      reload();
    } catch (err) {
      target.querySelector('.form-error').textContent = err.message;
      setBusy(submit, false);
    }
  });
}

// ============ 站点设置（管理员） ============
async function settings(ctx, panel) {
  const data = await api.get('/api/site');
  const s = data.settings || {};

  panel.innerHTML = `
    <div class="card card-pad" style="max-width:640px;">
      <h3 class="section-title" style="font-size:16px;">站点设置</h3>
      <div class="form-error"></div>
      <form data-settings-form>
        <div class="field">
          <label>站点名称</label>
          <input class="input" name="siteName" maxlength="60" value="${escapeHtml(s.siteName || '')}">
        </div>
        <div class="field">
          <label>站点描述</label>
          <textarea class="textarea" name="siteDescription" maxlength="200" style="min-height:72px;">${escapeHtml(s.siteDescription || '')}</textarea>
        </div>
        <div class="field">
          <label>首页公告</label>
          <textarea class="textarea" name="announcement" maxlength="500" style="min-height:72px;" placeholder="留空则不显示">${escapeHtml(s.announcement || '')}</textarea>
        </div>
        <label class="checkbox" style="margin-bottom:16px;">
          <input type="checkbox" name="registrationOpen" ${s.registrationOpen ? 'checked' : ''}> 允许新用户注册
        </label>
        <div class="row">
          <button class="btn" type="submit">保存设置</button>
        </div>
      </form>
    </div>

    <div class="card card-pad" style="max-width:640px;margin-top:16px;">
      <h3 class="section-title" style="font-size:16px;">维护工具</h3>
      <p class="muted small">重新统计标签使用数量，用于修正标签热度排序。</p>
      <button class="btn secondary" type="button" data-action="recalc-tags">刷新标签统计</button>
    </div>`;

  const form = panel.querySelector('[data-settings-form]');
  const errorBox = panel.querySelector('.form-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.textContent = '';
    const submit = form.querySelector('button[type="submit"]');
    setBusy(submit, true, '保存中…');
    try {
      await api.patch('/api/admin/settings', {
        siteName: form.siteName.value.trim(),
        siteDescription: form.siteDescription.value.trim(),
        announcement: form.announcement.value.trim(),
        registrationOpen: form.registrationOpen.checked
      });
      await loadSite();
      toast('设置已保存', 'success');
      setBusy(submit, false);
    } catch (err) {
      errorBox.textContent = err.message;
      setBusy(submit, false);
    }
  });

  panel.querySelector('[data-action="recalc-tags"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, '处理中…');
    try {
      await api.post('/api/admin/recalc-tags', {});
      toast('标签统计已刷新', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(btn, false);
    }
  });
}

// ============ 全站通知（管理员） ============
async function broadcast(ctx, panel) {
  panel.innerHTML = `
    <div class="card card-pad" style="max-width:640px;">
      <h3 class="section-title" style="font-size:16px;">发送全站通知</h3>
      <p class="muted small">该通知将发送给所有状态正常的用户，请谨慎使用。</p>
      <div class="form-error"></div>
      <form data-broadcast-form>
        <div class="field">
          <label>标题</label>
          <input class="input" name="title" maxlength="100" required placeholder="例如：社区规则更新">
        </div>
        <div class="field">
          <label>内容</label>
          <textarea class="textarea" name="body" maxlength="500" style="min-height:96px;" placeholder="通知正文（可选）"></textarea>
        </div>
        <div class="field">
          <label>跳转链接</label>
          <input class="input" name="link" maxlength="200" placeholder="/blog/xxx（可选）">
        </div>
        <button class="btn" type="submit">发送通知</button>
      </form>
    </div>`;

  const form = panel.querySelector('[data-broadcast-form]');
  const titleEl = form.querySelector('[name="title"]');
  const bodyEl = form.querySelector('[name="body"]');
  const linkEl = form.querySelector('[name="link"]');
  const errorBox = panel.querySelector('.form-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.textContent = '';
    if (!confirm('确定向所有用户发送这条通知？')) return;
    const submit = form.querySelector('button[type="submit"]');
    setBusy(submit, true, '发送中…');
    try {
      await api.post('/api/admin/broadcast', {
        title: titleEl.value.trim(),
        body: bodyEl.value.trim(),
        link: linkEl.value.trim()
      });
      toast('通知已发送', 'success');
      form.reset();
      setBusy(submit, false);
    } catch (err) {
      errorBox.textContent = err.message;
      setBusy(submit, false);
    }
  });
}