// HTTP 响应与请求辅助工具

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'error';
  }
}

export const badRequest = (msg, code) => new HttpError(400, msg, code || 'bad_request');
export const unauthorized = (msg = '请先登录') => new HttpError(401, msg, 'unauthorized');
export const forbidden = (msg = '没有权限执行该操作') => new HttpError(403, msg, 'forbidden');
export const notFound = (msg = '资源不存在') => new HttpError(404, msg, 'not_found');
export const conflict = (msg, code) => new HttpError(409, msg, code || 'conflict');
export const tooMany = (msg = '请求过于频繁，请稍后再试') => new HttpError(429, msg, 'rate_limited');
export const serviceUnavailable = (msg = '服务暂不可用') => new HttpError(503, msg, 'unavailable');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
};

function withHeaders(body, init = {}) {
  const headers = new Headers(init.headers || {});
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(body, { ...init, headers });
}

export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return withHeaders(JSON.stringify(data), { ...init, headers });
}

export function ok(data) {
  return json({ ok: true, data: data ?? null });
}

export function created(data, extraHeaders) {
  return json({ ok: true, data: data ?? null }, { status: 201, headers: extraHeaders });
}

export function noContent(extraHeaders) {
  return withHeaders(null, { status: 204, headers: extraHeaders });
}

export function errorResponse(err) {
  if (err instanceof HttpError) {
    return json({ ok: false, error: { code: err.code, message: err.message } }, { status: err.status });
  }
  console.error('Unhandled error:', err && err.stack ? err.stack : err);
  return json(
    { ok: false, error: { code: 'internal_error', message: '服务器内部错误' } },
    { status: 500 }
  );
}

export async function readJson(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw badRequest('请求体必须为 JSON');
  }
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw badRequest('请求体格式不正确');
    }
    return body;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw badRequest('JSON 解析失败');
  }
}

// 从请求体读取字符串字段并做长度校验
export function str(body, field, { required = false, min = 0, max = 10000, label } = {}) {
  const value = body[field];
  const name = label || field;
  if (value === undefined || value === null || value === '') {
    if (required) throw badRequest(`缺少字段：${name}`);
    return '';
  }
  if (typeof value !== 'string') throw badRequest(`${name} 必须是字符串`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw badRequest(`${name} 至少 ${min} 个字符`);
  if (trimmed.length > max) throw badRequest(`${name} 超过最大长度 ${max}`);
  return trimmed;
}

export function int(body, field, defaultValue = 0) {
  const value = body[field];
  if (value === undefined || value === null || value === '') return defaultValue;
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`${field} 必须是整数`);
  return n;
}

export function parseIntParam(value, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

export function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || '';
}

export { withHeaders };