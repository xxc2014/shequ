import { api } from '../api.js';
import { setState, state } from '../store.js';
import { escapeHtml, toast, setBusy } from '../ui.js';

function nextTarget(ctx) {
  const next = ctx.query.get('next');
  return next && next.startsWith('/') ? next : '/';
}

function redirectIfLoggedIn(ctx) {
  if (state.user) {
    ctx.navigate('/', { replace: true });
    return true;
  }
  return false;
}

export async function loginView(ctx) {
  if (redirectIfLoggedIn(ctx)) return;
  ctx.setTitle('登录');

  ctx.el.innerHTML = `
    <div class="container">
      <div class="form-narrow card">
        <div class="card-pad">
          <h1>登录</h1>
          <p class="muted small" style="margin:0 0 20px;">欢迎回来，继续你的技术交流。</p>
          <div class="form-error"></div>
          <form data-form="login">
            <div class="field">
              <label for="email">邮箱</label>
              <input class="input" id="email" name="email" type="email" autocomplete="email" required>
            </div>
            <div class="field">
              <label for="password">密码</label>
              <input class="input" id="password" name="password" type="password" autocomplete="current-password" required>
            </div>
            <button class="btn block" type="submit">登录</button>
          </form>
          <p class="small muted" style="text-align:center;margin:16px 0 0;">
            还没有账号？<a href="/register" data-link>立即注册</a>
          </p>
          <p class="tiny muted" style="text-align:center;margin:12px 0 0;">演示账号：admin@devhub.local / admin12345</p>
        </div>
      </div>
    </div>`;

  const form = ctx.el.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const errorBox = ctx.el.querySelector('.form-error');
    errorBox.textContent = '';
    setBusy(submit, true, '登录中…');
    try {
      const data = await api.post('/api/auth/login', {
        email: form.email.value.trim(),
        password: form.password.value
      });
      setState({ user: data.user });
      try {
        const me = await api.get('/api/auth/me');
        setState({ user: me.user, unread: me.unreadCount || 0 });
      } catch { /* ignore */ }
      toast('登录成功', 'success');
      ctx.navigate(nextTarget(ctx), { replace: true });
    } catch (err) {
      errorBox.textContent = err.message;
      setBusy(submit, false);
    }
  });
}

export async function registerView(ctx) {
  if (redirectIfLoggedIn(ctx)) return;
  const data = await api.get('/api/site').catch(() => null);
  const open = !data || data.settings.registrationOpen;

  ctx.setTitle('注册');

  if (!open) {
    ctx.el.innerHTML = `
      <div class="container"><div class="form-narrow card"><div class="card-pad">
        <h1>注册已关闭</h1>
        <p class="muted">管理员目前关闭了新用户注册，请稍后再试。</p>
        <a class="btn block" href="/login" data-link>返回登录</a>
      </div></div></div>`;
    return;
  }

  ctx.el.innerHTML = `
    <div class="container">
      <div class="form-narrow card">
        <div class="card-pad">
          <h1>创建账号</h1>
          <p class="muted small" style="margin:0 0 20px;">加入社区，参与技术讨论并关注官方博客。</p>
          <div class="form-error"></div>
          <form data-form="register">
            <div class="field">
              <label for="username">用户名</label>
              <input class="input" id="username" name="username" required minlength="3" maxlength="24" pattern="[a-zA-Z0-9_]{3,24}">
              <div class="hint">3-24 位字母、数字或下划线，将用于你的主页地址</div>
            </div>
            <div class="field">
              <label for="email">邮箱</label>
              <input class="input" id="email" name="email" type="email" autocomplete="email" required>
            </div>
            <div class="field">
              <label for="password">密码</label>
              <input class="input" id="password" name="password" type="password" autocomplete="new-password" required minlength="8">
              <div class="hint">至少 8 位，需同时包含字母和数字</div>
            </div>
            <button class="btn block" type="submit">注册</button>
          </form>
          <p class="small muted" style="text-align:center;margin:16px 0 0;">
            已有账号？<a href="/login" data-link>去登录</a>
          </p>
        </div>
      </div>
    </div>`;

  const form = ctx.el.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const errorBox = ctx.el.querySelector('.form-error');
    errorBox.textContent = '';
    setBusy(submit, true, '注册中…');
    try {
      const result = await api.post('/api/auth/register', {
        username: form.username.value.trim(),
        email: form.email.value.trim(),
        password: form.password.value
      });
      setState({ user: result.user, unread: 1 });
      toast('注册成功，欢迎加入！', 'success');
      ctx.navigate('/', { replace: true });
    } catch (err) {
      errorBox.textContent = err.message;
      setBusy(submit, false);
    }
  });
}