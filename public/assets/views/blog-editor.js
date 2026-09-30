import { api } from '../api.js';
import { renderMarkdown } from '../md.js';
import { escapeHtml, toast, setBusy, emptyState } from '../ui.js';

const MAX_TAGS = 6;

function tagsToInput(tags) {
  return (tags || []).map((t) => (typeof t === 'string' ? t : t.name)).join(', ');
}

export async function blogEditorView(ctx) {
  const editId = ctx.params[0] ? Number(ctx.params[0]) : 0;

  const categoriesData = await api.get('/api/blog/categories').catch(() => ({ categories: [] }));
  const categories = categoriesData.categories || [];

  let post = null;
  if (editId) {
    try {
      const data = await api.get(`/api/blog/${editId}`);
      post = data.post;
    } catch (err) {
      ctx.el.innerHTML = `<div class="container">${emptyState('文章不存在', err.message, '<a class="btn" href="/blog" data-link>返回博客</a>')}</div>`;
      return;
    }
  }

  ctx.setTitle(editId ? '编辑文章' : '写文章');

  const val = (key, fallback = '') => (post ? post[key] || '' : fallback);
  const categoryValue = post && post.category ? post.category.slug : '';
  const statusValue = post ? post.status : 'published';
  const featuredValue = post ? !!post.featured : false;
  const tagsValue = post ? tagsToInput(post.tags) : '';
  const coverValue = val('coverImage');

  ctx.el.innerHTML = `
    <div class="container" style="max-width:920px;">
      <div class="row between wrap" style="margin-bottom:16px;">
        <div>
          <h1 style="font-size:22px;margin:0 0 4px;">${editId ? '编辑文章' : '写文章'}</h1>
          <p class="muted small" style="margin:0;">官方博客 · 支持 Markdown</p>
        </div>
        <a class="btn ghost sm" href="/blog" data-link>返回博客</a>
      </div>

      <div class="card card-pad">
        <div class="form-error"></div>
        <form data-form="post">
          <div class="field">
            <label for="title">标题</label>
            <input class="input" id="title" name="title" maxlength="200" minlength="4" required value="${escapeHtml(val('title'))}">
          </div>

          <div class="row wrap" style="gap:14px;align-items:flex-start;">
            <div class="field" style="flex:1;min-width:200px;">
              <label for="category">分类</label>
              <select class="select" id="category" name="category">
                <option value="">未分类</option>
                ${categories.map((c) => `<option value="${escapeHtml(c.slug)}" ${c.slug === categoryValue ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field" style="flex:1;min-width:200px;">
              <label for="tags">标签</label>
              <input class="input" id="tags" name="tags" maxlength="150" value="${escapeHtml(tagsValue)}"
                     placeholder="用英文逗号分隔，最多 ${MAX_TAGS} 个">
            </div>
          </div>

          <div class="field">
            <label for="summary">摘要</label>
            <textarea class="textarea" id="summary" name="summary" maxlength="300" style="min-height:72px;"
                      placeholder="留空将自动从正文提取">${escapeHtml(val('summary'))}</textarea>
          </div>

          <div class="field">
            <label for="coverImage">封面图</label>
            <input class="input" id="coverImage" name="coverImage" maxlength="500" value="${escapeHtml(coverValue)}" placeholder="https://… 或 /media/…">
            <div style="margin-top:8px;">
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" id="cover-upload">
            </div>
            <div data-cover-preview style="margin-top:10px;${coverValue ? '' : 'display:none;'}">
              ${coverValue ? `<img src="${escapeHtml(coverValue)}" alt="封面预览" style="max-height:180px;border-radius:var(--radius-sm);border:1px solid var(--border);">` : ''}
            </div>
          </div>

          <div class="field">
            <div class="row between" style="margin-bottom:6px;">
              <label for="body" style="margin:0;">正文</label>
              <button class="btn ghost sm" type="button" data-action="toggle-preview">预览</button>
            </div>
            <textarea class="textarea tall" id="body" name="body" minlength="20" maxlength="200000" required
                      placeholder="开始撰写正文…支持 Markdown">${escapeHtml(val('body'))}</textarea>
            <div class="prose card-pad" data-preview style="display:none;border:1px solid var(--border);border-radius:var(--radius-sm);margin-top:8px;"></div>
          </div>

          <div class="row wrap" style="gap:22px;margin-bottom:14px;">
            <div class="field" style="margin:0;">
              <label for="status">状态</label>
              <select class="select" id="status" name="status">
                <option value="published" ${statusValue === 'published' ? 'selected' : ''}>直接发布</option>
                <option value="draft" ${statusValue === 'draft' ? 'selected' : ''}>保存为草稿</option>
              </select>
            </div>
            <label class="checkbox" style="margin-top:24px;">
              <input type="checkbox" name="featured" ${featuredValue ? 'checked' : ''}> 设为精选
            </label>
          </div>

          <div class="row">
            <button class="btn" type="submit">${editId ? '保存修改' : '发布文章'}</button>
            <button class="btn ghost" type="button" data-action="cancel">取消</button>
          </div>
        </form>
      </div>
    </div>`;

  const form = ctx.el.querySelector('form[data-form="post"]');
  const titleEl = form.querySelector('#title');
  const summaryEl = form.querySelector('#summary');
  const categoryEl = form.querySelector('#category');
  const tagsEl = form.querySelector('#tags');
  const bodyEl = form.querySelector('#body');
  const statusEl = form.querySelector('#status');
  const featuredEl = form.querySelector('[name="featured"]');
  const coverEl = form.querySelector('#coverImage');
  const previewEl = form.querySelector('[data-preview]');
  const coverPreview = ctx.el.querySelector('[data-cover-preview]');
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

  form.querySelector('#cover-upload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const res = await api.upload(file);
      coverEl.value = res.url;
      coverPreview.style.display = 'block';
      coverPreview.innerHTML = `<img src="${escapeHtml(res.url)}" alt="封面预览" style="max-height:180px;border-radius:var(--radius-sm);border:1px solid var(--border);">`;
      toast('封面已上传，记得保存', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  form.querySelector('[data-action="cancel"]').addEventListener('click', () => {
    ctx.navigate(editId && post ? `/blog/${encodeURIComponent(post.slug)}` : '/blog');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.textContent = '';
    const payload = {
      title: titleEl.value.trim(),
      body: bodyEl.value.trim(),
      summary: summaryEl.value.trim(),
      coverImage: coverEl.value.trim(),
      category: categoryEl.value,
      tags: tagsEl.value.split(',').map((t) => t.trim()).filter(Boolean).slice(0, MAX_TAGS),
      status: statusEl.value,
      featured: featuredEl.checked
    };
    if (payload.title.length < 4) { errorBox.textContent = '标题至少需要 4 个字'; return; }
    if (payload.body.length < 20) { errorBox.textContent = '正文至少需要 20 个字'; return; }

    const submit = form.querySelector('button[type="submit"]');
    setBusy(submit, true, '保存中…');
    try {
      const res = editId
        ? await api.patch(`/api/blog/${editId}`, payload)
        : await api.post('/api/blog', payload);
      toast(payload.status === 'published' ? '文章已发布' : '草稿已保存', 'success');
      ctx.navigate(`/blog/${encodeURIComponent(res.post.slug)}`);
    } catch (err) {
      errorBox.textContent = err.message;
      setBusy(submit, false);
    }
  });
}