import { api } from '../api.js';
import { state, isStaff } from '../store.js';
import { renderMarkdown } from '../md.js';
import {
  escapeHtml, formatTime, avatarHtml, roleBadge, tagsHtml, toast, setBusy, emptyState
} from '../ui.js';

function replyHtml(reply, children, depth, ctx) {
  const user = state.user;
  const canEdit = user && (user.id === reply.author.id || isStaff(user));
  return `
    <div class="reply ${depth > 0 ? 'nested' : ''}" data-reply="${reply.id}">
      ${avatarHtml(reply.author)}
      <div class="reply-body">
        <div class="reply-head">
          <a href="/u/${encodeURIComponent(reply.author.username)}" data-link style="font-weight:600;color:var(--text);">${escapeHtml(reply.author.displayName || reply.author.username)}</a>
          ${roleBadge(reply.author.role)}
          <span class="muted tiny">${formatTime(reply.createdAt)}</span>
          ${reply.updatedAt > reply.createdAt + 5 ? '<span class="tiny muted">（已编辑）</span>' : ''}
          <span class="muted tiny" style="margin-left:auto;">#${reply.id}</span>
        </div>
        <div class="prose">${renderMarkdown(reply.body)}</div>
        <div class="reply-actions">
          <button class="link-btn" data-action="like-reply" data-id="${reply.id}">
            ${reply.liked ? '👍 已赞' : '👍 赞'} (${reply.likeCount})
          </button>
          ${user ? `<button class="link-btn" data-action="reply-to" data-id="${reply.id}" data-name="${escapeHtml(reply.author.displayName || reply.author.username)}">回复</button>` : ''}
          ${canEdit ? `<button class="link-btn" data-action="edit-reply" data-id="${reply.id}">编辑</button>` : ''}
          ${canEdit ? `<button class="link-btn danger" data-action="delete-reply" data-id="${reply.id}">删除</button>` : ''}
          ${user && user.id !== reply.author.id ? `<button class="link-btn danger" data-action="report" data-type="reply" data-id="${reply.id}">举报</button>` : ''}
        </div>
        ${children.length ? children.map((child) => replyHtml(child.reply, child.children, depth + 1, ctx)).join('') : ''}
      </div>
    </div>`;
}

function buildTree(replies) {
  const map = new Map();
  const roots = [];
  for (const r of replies) map.set(r.id, { reply: r, children: [] });
  for (const node of map.values()) {
    if (node.reply.parentId && map.has(node.reply.parentId)) {
      map.get(node.reply.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export async function threadView(ctx) {
  const id = ctx.params[0];
  const [threadData, repliesData] = await Promise.all([
    api.get(`/api/threads/${id}`),
    api.get(`/api/threads/${id}/replies`)
  ]);
  const thread = threadData.thread;
  const user = state.user;
  const staff = isStaff(user);
  const isOwner = user && user.id === thread.author.id;

  ctx.setTitle(thread.title);

  const tree = buildTree(repliesData.replies);

  ctx.el.innerHTML = `
    <div class="container">
      <div class="layout">
        <div>
          <article class="card">
            <div class="card-pad">
              <div class="row wrap small muted" style="gap:8px;margin-bottom:10px;">
                <a class="tag primary" href="/forum?category=${encodeURIComponent(thread.category.slug)}" data-link>${escapeHtml(thread.category.icon || '')} ${escapeHtml(thread.category.name)}</a>
                ${thread.isPinned ? '<span class="pill primary">置顶</span>' : ''}
                ${thread.isLocked ? '<span class="pill gray">已锁定</span>' : ''}
              </div>
              <h1 style="font-size:23px;margin:0 0 12px;line-height:1.4;">${escapeHtml(thread.title)}</h1>
              <div class="row wrap" style="gap:10px;">
                ${avatarHtml(thread.author)}
                <div>
                  <div style="font-weight:600;">${escapeHtml(thread.author.displayName || thread.author.username)}</div>
                  <div class="tiny muted">发布于 ${formatTime(thread.createdAt)} · 👁 ${thread.viewCount} · 💬 ${thread.replyCount}</div>
                </div>
                <div style="margin-left:auto;" class="row wrap">
                  <button class="btn sm ${thread.liked ? 'liked' : 'secondary'}" data-action="like-thread">
                    👍 ${thread.liked ? '已赞' : '点赞'} <span id="thread-like-count">${thread.likeCount}</span>
                  </button>
                  ${thread.author && user && user.id !== thread.author.id ? '<button class="btn sm ghost" data-action="report" data-type="thread" data-id="' + thread.id + '">举报</button>' : ''}
                </div>
              </div>
            </div>
            <div class="card-pad" style="border-top:1px solid var(--border);">
              <div class="prose">${renderMarkdown(thread.body)}</div>
              ${thread.tags && thread.tags.length ? `<div class="row wrap" style="gap:6px;margin-top:20px;">${tagsHtml(thread.tags)}</div>` : ''}
            </div>
            ${(isOwner || staff) ? `
              <div class="card-pad" style="border-top:1px solid var(--border);">
                <div class="row wrap">
                  ${isOwner ? `<a class="btn sm secondary" href="/t/${thread.id}" data-action="edit-thread" id="edit-thread-btn">编辑帖子</a>` : ''}
                  ${isOwner || staff ? '<button class="btn sm danger" data-action="delete-thread">删除帖子</button>' : ''}
                  ${staff ? `
                    <button class="btn sm ghost" data-action="moderate" data-field="isPinned" data-value="${thread.isPinned ? 'false' : 'true'}">${thread.isPinned ? '取消置顶' : '置顶'}</button>
                    <button class="btn sm ghost" data-action="moderate" data-field="isLocked" data-value="${thread.isLocked ? 'false' : 'true'}">${thread.isLocked ? '解锁' : '锁定'}</button>
                    <button class="btn sm ghost" data-action="moderate" data-field="status" data-value="hidden">隐藏</button>` : ''}
                </div>
              </div>` : ''}
          </article>

          <section class="card" style="margin-top:20px;">
            <div class="card-pad" style="padding-bottom:6px;">
              <h2 class="section-title" style="font-size:16px;">全部回复（${repliesData.replies.length}）</h2>
            </div>
            <div class="card-pad" style="padding-top:0;">
              ${repliesData.replies.length
                ? tree.map((node) => replyHtml(node.reply, node.children, 0, ctx)).join('')
                : '<p class="muted small">还没有回复，来说点什么吧。</p>'}
            </div>
          </section>

          ${thread.isLocked
            ? '<div class="card card-pad muted" style="margin-top:16px;">该帖已锁定，无法继续回复。</div>'
            : user
              ? `<section class="card card-pad" style="margin-top:16px;" id="reply-box">
                   <h3 class="section-title" style="font-size:16px;">发表回复</h3>
                   <div class="form-error"></div>
                   <div id="reply-target" class="small muted" style="margin-bottom:8px;display:none;"></div>
                   <form data-form="reply">
                     <input type="hidden" name="parentId" value="">
                     <textarea class="textarea" name="body" placeholder="支持 Markdown，@ 提及用户会收到通知" required></textarea>
                     <div class="row" style="margin-top:12px;">
                       <button class="btn" type="submit">提交回复</button>
                       <button class="btn ghost" type="button" id="cancel-reply-target" style="display:none;">取消回复楼层</button>
                     </div>
                   </form>
                 </section>`
              : `<div class="card card-pad" style="margin-top:16px;"><a href="/login?next=${encodeURIComponent(location.pathname)}" data-link>登录</a> 后即可参与讨论。</div>`}
        </div>

        <aside class="stack">
          <div class="card card-pad">
            <h3 class="section-title" style="font-size:15px;">关于作者</h3>
            <div class="row">
              ${avatarHtml(thread.author, 'lg')}
              <div>
                <a href="/u/${encodeURIComponent(thread.author.username)}" data-link style="font-weight:700;color:var(--text);">${escapeHtml(thread.author.displayName || thread.author.username)}</a>
                <div class="tiny muted">@${escapeHtml(thread.author.username)}</div>
              </div>
            </div>
          </div>
          <div class="card card-pad">
            <h3 class="section-title" style="font-size:15px;">帖子信息</h3>
            <div class="stack small" style="gap:8px;">
              <div class="row between"><span class="muted">浏览</span><span>${thread.viewCount}</span></div>
              <div class="row between"><span class="muted">回复</span><span>${thread.replyCount}</span></div>
              <div class="row between"><span class="muted">点赞</span><span>${thread.likeCount}</span></div>
              <div class="row between"><span class="muted">发布时间</span><span>${formatTime(thread.createdAt)}</span></div>
            </div>
          </div>
          <div class="card card-pad">
            <a class="btn secondary block" href="/forum?category=${encodeURIComponent(thread.category.slug)}" data-link>查看更多「${escapeHtml(thread.category.name)}」</a>
          </div>
        </aside>
      </div>
    </div>`;

  const reload = () => threadView(ctx);

  // 点赞帖子
  ctx.el.querySelector('[data-action="like-thread"]')?.addEventListener('click', async (e) => {
    if (!state.user) return ctx.navigate('/login');
    const btn = e.currentTarget;
    setBusy(btn, true, '…');
    try {
      const res = await api.post('/api/likes', { targetType: 'thread', targetId: Number(thread.id) });
      btn.classList.toggle('liked', res.liked);
      btn.innerHTML = `👍 ${res.liked ? '已赞' : '点赞'} <span id="thread-like-count">${res.likeCount}</span>`;
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(btn, false); }
  });

  // 编辑帖子（跳转到编辑器，用查询参数带出内容）
  const editBtn = ctx.el.querySelector('#edit-thread-btn');
  if (editBtn) {
    editBtn.addEventListener('click', (e) => {
      e.preventDefault();
      sessionStorage.setItem('edit_thread', JSON.stringify({ id: thread.id, title: thread.title, body: thread.body, category: thread.category.slug, tags: (thread.tags || []).map((t) => t.name) }));
      ctx.navigate('/new?edit=' + thread.id);
    });
  }

  ctx.el.querySelector('[data-action="delete-thread"]')?.addEventListener('click', async () => {
    if (!confirm('确定删除这个帖子？此操作不可撤销。')) return;
    try { await api.del(`/api/threads/${thread.id}`); toast('帖子已删除'); ctx.navigate('/forum'); }
    catch (err) { toast(err.message, 'error'); }
  });

  // 版主操作
  ctx.el.querySelectorAll('[data-action="moderate"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const field = btn.dataset.field;
      let value = btn.dataset.value;
      if (field === 'isPinned' || field === 'isLocked') value = value === 'true';
      try {
        await api.patch(`/api/admin/threads/${thread.id}`, { [field]: value });
        toast('操作成功');
        reload();
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  // 回复表单
  const form = ctx.el.querySelector('form[data-form="reply"]');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = form.body.value.trim();
      if (!body) return;
      const submit = form.querySelector('button[type="submit"]');
      setBusy(submit, true);
      try {
        await api.post(`/api/threads/${thread.id}/replies`, {
          body,
          parentId: Number(form.parentId.value) || 0
        });
        toast('回复成功');
        reload();
      } catch (err) {
        const errBox = ctx.el.querySelector('#reply-box .form-error');
        if (errBox) errBox.textContent = err.message;
        toast(err.message, 'error');
        setBusy(submit, false);
      }
    });
  }

  // 回复楼层定位
  ctx.el.querySelectorAll('[data-action="reply-to"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!form) return;
      form.parentId.value = btn.dataset.id;
      const target = ctx.el.querySelector('#reply-target');
      target.style.display = 'block';
      target.textContent = `正在回复 @${btn.dataset.name}（#${btn.dataset.id}）`;
      ctx.el.querySelector('#cancel-reply-target').style.display = 'inline-flex';
      ctx.el.querySelector('#reply-box').scrollIntoView({ behavior: 'smooth', block: 'center' });
      form.body.focus();
    });
  });
  ctx.el.querySelector('#cancel-reply-target')?.addEventListener('click', () => {
    form.parentId.value = '';
    ctx.el.querySelector('#reply-target').style.display = 'none';
    ctx.el.querySelector('#cancel-reply-target').style.display = 'none';
  });

  // 回复点赞 / 编辑 / 删除 / 举报
  ctx.el.querySelectorAll('[data-action="like-reply"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!state.user) return ctx.navigate('/login');
      try {
        const res = await api.post('/api/likes', { targetType: 'reply', targetId: Number(btn.dataset.id) });
        btn.textContent = `👍 ${res.liked ? '已赞' : '赞'} (${res.likeCount})`;
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  ctx.el.querySelectorAll('[data-action="edit-reply"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const node = btn.closest('[data-reply]');
      const prose = node.querySelector('.prose');
      const current = repliesData.replies.find((r) => String(r.id) === btn.dataset.id);
      const textarea = document.createElement('textarea');
      textarea.className = 'textarea';
      textarea.value = current.body;
      const row = document.createElement('div');
      row.className = 'row';
      row.style.marginTop = '8px';
      row.innerHTML = '<button class="btn sm" data-editor="save">保存</button><button class="btn sm ghost" data-editor="cancel">取消</button>';
      prose.replaceWith(textarea);
      textarea.after(row);
      row.querySelector('[data-editor="save"]').addEventListener('click', async () => {
        try {
          await api.patch(`/api/replies/${btn.dataset.id}`, { body: textarea.value.trim() });
          toast('已更新');
          reload();
        } catch (err) { toast(err.message, 'error'); }
      });
      row.querySelector('[data-editor="cancel"]').addEventListener('click', () => reload());
    });
  });

  ctx.el.querySelectorAll('[data-action="delete-reply"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('确定删除这条回复？')) return;
      try { await api.del(`/api/replies/${btn.dataset.id}`); toast('已删除'); reload(); }
      catch (err) { toast(err.message, 'error'); }
    });
  });

  // 举报
  ctx.el.querySelectorAll('[data-action="report"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!state.user) return ctx.navigate('/login');
      const reason = prompt('请输入举报原因（如：广告、人身攻击、违法违规等）');
      if (!reason) return;
      try {
        await api.post('/api/reports', { targetType: btn.dataset.type, targetId: Number(btn.dataset.id), reason });
        toast('举报已提交，感谢反馈', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}