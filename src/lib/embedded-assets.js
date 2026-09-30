// 内嵌静态资源服务：当未绑定 env.ASSETS（Cloudflare 静态资源托管）时，
// 由 Worker 直接提供前端页面，保证单脚本部署也能正常访问站点。
//
// 资源以 gzip + base64 内嵌，首次请求时解压并缓存，避免冷启动做重复工作。
import { ASSETS_GZIP_B64, EMBEDDED_HEADER_RULES } from '../generated/assets.js';

const DEFAULT_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
};

// 把 _headers 里的通配模式转成正则
const compiledRules = EMBEDDED_HEADER_RULES.map((rule) => ({
  regex: new RegExp(
    '^' + rule.pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
  ),
  headers: rule.headers
}));

function headersFor(pathname) {
  const headers = { ...DEFAULT_SECURITY_HEADERS };
  for (const rule of compiledRules) {
    if (rule.regex.test(pathname)) Object.assign(headers, rule.headers);
  }
  return headers;
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let assetsPromise = null;

function loadAssets() {
  if (!assetsPromise) {
    assetsPromise = (async () => {
      const bytes = base64ToBytes(ASSETS_GZIP_B64);
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      const text = await new Response(stream).text();
      return JSON.parse(text);
    })();
  }
  return assetsPromise;
}

function normalize(pathname) {
  if (pathname === '/') return '/index.html';
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

function send(request, asset, headers) {
  const method = request.method === 'HEAD' ? 'HEAD' : 'GET';
  return new Response(method === 'HEAD' ? null : base64ToBytes(asset.d), { status: 200, headers });
}

// 读取内嵌资源文本：供服务端注入 SEO 元信息时复用 index.html 外壳
export async function readEmbeddedAsset(pathname) {
  const assets = await loadAssets();
  const asset = assets[normalize(pathname)];
  if (!asset) return null;
  return new TextDecoder().decode(base64ToBytes(asset.d));
}

export async function serveEmbeddedAsset(request) {
  const assets = await loadAssets();
  const url = new URL(request.url);
  const pathname = normalize(url.pathname);
  const asset = assets[pathname];

  if (asset) {
    const headers = headersFor(pathname);
    headers['Content-Type'] = asset.t;
    if (!headers['Cache-Control']) {
      headers['Cache-Control'] = asset.t.startsWith('text/html')
        ? 'no-cache'
        : 'public, max-age=3600';
    }
    return send(request, asset, headers);
  }

  // SPA 回退：仅对页面导航请求返回 index.html
  const accept = request.headers.get('accept') || '';
  const isNavigation =
    (request.method === 'GET' || request.method === 'HEAD') && accept.includes('text/html');
  const shell = assets['/index.html'];
  if (isNavigation && shell) {
    const headers = headersFor('/index.html');
    headers['Content-Type'] = shell.t;
    headers['Cache-Control'] = 'no-cache';
    return send(request, shell, headers);
  }

  return new Response('Not Found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...DEFAULT_SECURITY_HEADERS }
  });
}