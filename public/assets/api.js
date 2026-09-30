// 与后端 /api 交互的统一封装
async function request(path, { method = 'GET', body, isForm = false } = {}) {
  const options = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    if (isForm) {
      options.body = body;
    } else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
  }

  let res;
  try {
    res = await fetch(path, options);
  } catch (err) {
    throw new Error('网络异常，请检查连接后重试');
  }

  const text = await res.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = null; }
  }

  if (!res.ok || (payload && payload.ok === false)) {
    const message = (payload && payload.error && payload.error.message) || `请求失败（${res.status}）`;
    const error = new Error(message);
    error.status = res.status;
    error.code = payload && payload.error ? payload.error.code : undefined;
    throw error;
  }
  return payload ? payload.data : null;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  del: (path) => request(path, { method: 'DELETE' }),
  upload(file) {
    const form = new FormData();
    form.append('file', file);
    return request('/api/uploads', { method: 'POST', body: form, isForm: true });
  }
};

export function buildQuery(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}