import { api } from '../api.js';
import { state } from '../store.js';
import { renderMarkdown } from '../md.js';
import { escapeHtml, toast, setBusy, emptyState } from '../ui.js';

const MAX_TAGS = 5;
const DRAFT_KEY = 'new_thread_draft';

function tagsToInput(tags) {
  return (tags || []).map((t) => (typeof t === 'string' ? t : t.name)).join(', ');
}

function readDraft() {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
}

export async function threadEditorView(ctx) {
  const editId = ctx.query.get('edit') ? Number(ctx.query.get('edit')) : 0;
  const categories = (state.site && state.site.categories) || [];

  let existing = null;
  if (editId) {
    try {
      const data = await api.get(`/api/threads/${editId}`);
      existing = data.thread;
    } catch (err) {
      ctx.el.innerHTML = `<div class="container">${emptyState('帖子不存在', err.message, '<a class="btn" href="/forum" data-link>返回论坛</a>')}</div>`;
      return;
    }
  }

  const draft = editId ? null : readDraft();
  const val = (key, fallback = '') => {
    if (existing) return existing[key] || '';
    if (draft && draft[key] !== undefined) return draft[key];
    return fallback;
  };

  ctx.setTitle(editId ? '编辑帖子' : '发布新帖');

  if (!categories.length) {
    ctx.el.innerHTML = `<div class="container">${emptyState('暂无可用版块', '请联系管理员创建版块后再发帖。', '<a class="btn" href="/forum" data-link>返回论坛</a>')}</div>`;
    return;
  }

  const categoryValue = existing ? existing.category.slug : (draft && draft.category) || categories[0].slug;
  const tagValue = existing ? tagsToInput(existing.tags) : (draft && draft.tags) || '';

  ctx.el.innerHTML = `
    <div class="container" style="max-width:860px;">
      <h1 style="font-size:22px;margin:0 0 4px;">${editId ? '编辑帖子' : '发布新帖'}</h1>
      <p class="muted small" style="margin:0 0 18px;">支持 Markdown 语法，请保持友善交流、内容相关。</p>

      <div class="card card-pad">
        <div class="form-error"></div>
        <form data-form="thread">
          <div class="field">
            <label for="title">标题</label>
            <input class="input" id="title" name="title" maxlength="150" minlength="4" required
                   value="${escapeHtml(val('title'))}" placeholder="用一句话描述你的问题或主题">
          </div>

          <div class="row wrap" style="gap:14px;align-items:flex-start;">
            <div class="field" style="flex:1;min-width:200px;">
              <label for="category">版块</label>
              <select class="select" id="category" name="category" ${editId ? 'disabled' : ''}>
                ${categories.map((c) => `<option value="${escapeHtml(c.slug)}" ${c.slug === categoryValue ? 'selected' : ''}>${escapeHtml(c.icon || '')} ${escapeHtml(c.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field" style="flex:1;min-width:200px;">
              <label for="tags">标签</label>
              <input class="input" id="tags" name="tags" maxlength="120" value="${escapeHtml(tagValue)}"
                     placeholder="用英文逗号分隔，最多 ${MAX_TAGS} 个" ${editId ? 'disabled' : ''}>
            </div>
          </div>
          ${editId ? '<p class="hint" style="margin:-6px 0 14px;">编辑模式下暂不支持修改版块与标签。</p>' : ''}

          <div class="field">
            <div class="row between" style="margin-bottom:6px;">
              <label for="body" style="margin:0;">正文</label>
              <button class="btn ghost sm" type="button" data-action="toggle-preview">预览</button>
            </div>
            <textarea class="textarea tall" id="body" name="body" minlength="10" maxlength="50000" required
                      placeholder="描述你的问题、背景与已尝试的方案…支持 Markdown">${escapeHtml(val('body'))}</textarea>
            <div class="prose card-pad" data-preview style="display:none;border:1px solid var(--border);border-radius:var(--radius-sm);margin-top:8px;"></div>
          </div>

          <div class="row">
            <button class="btn" type="submit">${editId ? '保存修改' : '发布帖子'}</button>
            <button class="btn ghost" type="button" data-action="cancel">取消</button>
          </div>
        </form>
      </div>
    </div>`;

  const form = ctx.el.querySelector('form[data-form="thread"]');
  const titleEl = form.querySelector('#title');
  const bodyEl = form.querySelector('#body');
  const categoryEl = form.querySelector('#category');
  const tagsEl = form.querySelector('#tags');
  const previewEl = form.querySelector('[data-preview]');
  const errorBox = ctx.el.querySelector('.form-error');

  form.querySelector('[data-action="toggle-preview"]').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const showing = previewEl.style.display !== 'none';
    if (showing) {
      previewEl.style.display = 'none';
      bodyEl.style.display = '';
      btn.textContent = '预览';
    } else {
      previewEl.innerHTML = renderMarkdown(bodyEl.value) || '<p class="muted">没有内容可预览</p>';
      previewEl.style.display = 'block';
      bodyEl.style.display = 'none';
      btn.textContent = '继续编辑';
    }
  });

  form.querySelector('[data-action="cancel"]').addEventListener('click', () => {
    ctx.navigate(editId ? `/t/${editId}` : '/forum');
  });

  if (!editId) {
    const saveDraft = () => {
      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
          title: titleEl.value,
          body: bodyEl.value,
          category: categoryEl.value,
          tags: tagsEl.value
        }));
      } catch { /* 忽略存储配额问题 */ }
    };
    titleEl.addEventListener('input', saveDraft);
    bodyEl.addEventListener('input', saveDraft);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.textContent = '';
    const title = titleEl.value.trim();
    const body = bodyEl.value.trim();
    if (title.length < 4) { errorBox.textContent = '标题至少需要 4 个字'; return; }
    if (body.length < 10) { errorBox.textContent = '正文至少需要 10 个字'; return; }

    const tags = tagsEl.value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, MAX_TAGS);
    const submit = form.querySelector('button[type="submit"]');
    setBusy(submit, true, editId ? '保存中…' : '发布中…');
    try {
      if (editId) {
        const res = await api.patch(`/api/threads/${editId}`, { title, body });
        sessionStorage.removeItem('edit_thread');
        toast('帖子已更新', 'success');
        ctx.navigate(`/t/${res.thread.id}`);
      } else {
        const res = await api.post('/api/threads', { title, body, category: categoryEl.value, tags });
        sessionStorage.removeItem(DRAFT_KEY);
        toast('发布成功', 'success');
        ctx.navigate(`/t/${res.thread.id}`);
      }
    } catch (err) {
      errorBox.textContent = err.message;
      setBusy(submit, false);
    }
  });
}