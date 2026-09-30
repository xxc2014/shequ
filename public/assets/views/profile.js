import { api, buildQuery } from '../api.js';
import { state, setState } from '../store.js';
import { escapeHtml, formatTime, formatDate, avatarHtml, roleBadge, emptyState, toast, setBusy } from '../ui.js';

export async function profileView(ctx) {
  const username = ctx.params[0];
  let data;
  try {
    data = await api.get(`/api/users/${encodeURIComponent(username)}`);
  } catch {
    ctx.setTitle('用户不存在');
    ctx.el.innerHTML = `<div class="container">${emptyState('用户不存在', '该用户可能已被删除。', '<a class="btn" href="/forum" data-link>返回论坛</a>')}</div>`;
    return;
  }

  const user = data.user;
  const stats = data.stats;
  const isSelf = state.user && state.user.id === user.id;
  const tab = ctx.query.get('tab') === 'posts' ? 'posts' : 'threads';

  ctx.setTitle(user.displayName || user.username);

  let activity = '';
  if (tab === 'threads') {
    const list = await api.get(`/api/threads${buildQuery({ author: user.username, pageSize: 20 })}`);
    activity = list.threads.length
      ? list.threads.map((t) => `
          <div class="thread-item">
            <div class="thread-main">
              <a class="thread-title" href="/t/${t.id}" data-link>${escapeHtml(t.title)}</a>
              <div class="thread-meta">
                <span>${escapeHtml(t.category.name)}</span>
                <span>· ${formatTime(t.createdAt)}</span>
                <span>· ${t.replyCount} 回复 · ${t.likeCount} 赞</span>
              </div>
            </div>
          </div>`).join('')
      : emptyState('还没有发帖');
  } else {
    const list = await api.get(`/api/blog${buildQuery({ author: user.username, pageSize: 20 })}`);
    activity = list.posts.length
      ? list.posts.map((p) => `
          <div class="thread-item">
            <div class="thread-main">
              <a class="thread-title" href="/blog/${encodeURIComponent(p.slug)}" data-link>${escapeHtml(p.title)}</a>
              <div class="thread-meta">
                <span>${p.category ? escapeHtml(p.category.name) : '未分类'}</span>
                <span>· ${formatTime(p.publishedAt)}</span>
                <span>· 👁 ${p.viewCount} · 👍 ${p.likeCount}</span>
              </div>
            </div>
          </div>`).join('')
      : emptyState('还没有发表文章');
  }

  ctx.el.innerHTML = `
    <div class="container">
      <div class="layout">
        <div>
          <section class="card card-pad">
            <div class="row wrap" style="gap:16px;">
              ${avatarHtml(user, 'lg')}
              <div style="flex:1;min-width:200px;">
                <h1 style="margin:0;font-size:22px;">${escapeHtml(user.displayName || user.username)} ${roleBadge(user.role)}</h1>
                <div class="muted small">@${escapeHtml(user.username)}</div>
                ${user.bio ? `<p style="margin:10px 0 0;">${escapeHtml(user.bio)}</p>` : '<p class="muted small" style="margin:10px 0 0;">这个人很懒，还没有填写简介。</p>'}
                <div class="tiny muted" style="margin-top:8px;">加入于 ${formatDate(user.createdAt)}</div>
              </div>
              ${isSelf ? '<button class="btn secondary sm" id="edit-profile-btn">编辑资料</button>' : ''}
            </div>
          </section>

          <section class="card" style="margin-top:20px;">
            <div class="tabs" style="margin:0;padding:0 20px;">
              <a href="/u/${encodeURIComponent(user.username)}?tab=threads" data-link class="${tab === 'threads' ? 'active' : ''}">帖子 (${stats.threads})</a>
              <a href="/u/${encodeURIComponent(user.username)}?tab=posts" data-link class="${tab === 'posts' ? 'active' : ''}">文章 (${stats.posts})</a>
            </div>
            <div>${activity}</div>
          </section>
        </div>

        <aside class="stack">
          <div class="card card-pad">
            <h3 class="section-title" style="font-size:15px;">数据概览</h3>
            <div class="stack small" style="gap:8px;">
              <div class="row between"><span class="muted">发帖</span><span>${stats.threads}</span></div>
              <div class="row between"><span class="muted">回复</span><span>${stats.replies}</span></div>
              <div class="row between"><span class="muted">文章</span><span>${stats.posts}</span></div>
              <div class="row between"><span class="muted">获赞</span><span>${stats.likes}</span></div>
            </div>
          </div>
        </aside>
      </div>
    </div>`;

  const editBtn = ctx.el.querySelector('#edit-profile-btn');
  if (editBtn) {
    editBtn.addEventListener('click', () => openEditor(ctx, user));
  }
}

function openEditor(ctx, user) {
  const container = ctx.el.querySelector('.layout > div');
  const card = document.createElement('section');
  card.className = 'card card-pad';
  card.style.marginTop = '20px';
  card.innerHTML = `
    <h3 class="section-title" style="font-size:16px;">编辑资料</h3>
    <div class="form-error"></div>
    <form data-form="profile">
      <div class="field">
        <label>昵称</label>
        <input class="input" name="displayName" maxlength="40" value="${escapeHtml(user.displayName || '')}">
      </div>
      <div class="field">
        <label>头像地址</label>
        <input class="input" name="avatarUrl" maxlength="500" placeholder="https://… 或 /media/…" value="${escapeHtml(user.avatarUrl || '')}">
        <div class="hint">可上传图片后粘贴返回的地址</div>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" id="avatar-upload" style="margin-top:8px;">
      </div>
      <div class="field">
        <label>个人简介</label>
        <textarea class="textarea" name="bio" maxlength="300" placeholder="介绍一下你自己">${escapeHtml(user.bio || '')}</textarea>
      </div>
      <div class="row">
        <button class="btn" type="submit">保存</button>
        <button class="btn ghost" type="button" id="cancel-profile">取消</button>
      </div>
    </form>`;

  container.insertBefore(card, container.firstChild);
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const form = card.querySelector('form');
  card.querySelector('#cancel-profile').addEventListener('click', () => card.remove());

  card.querySelector('#avatar-upload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const res = await api.upload(file);
      form.avatarUrl.value = res.url;
      toast('头像已上传，记得点保存', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    setBusy(submit, true, '保存中…');
    try {
      const res = await api.patch('/api/users/me', {
        displayName: form.displayName.value.trim(),
        avatarUrl: form.avatarUrl.value.trim(),
        bio: form.bio.value.trim()
      });
      setState({ user: { ...state.user, ...res.user } });
      toast('资料已更新', 'success');
      ctx.navigate(`/u/${encodeURIComponent(res.user.username)}`);
    } catch (err) {
      card.querySelector('.form-error').textContent = err.message;
      setBusy(submit, false);
    }
  });
}