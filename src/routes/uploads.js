import { created, badRequest, notFound, withHeaders, serviceUnavailable } from '../lib/http.js';
import { requireUser, rateLimit } from '../lib/session.js';
import { randomHex } from '../lib/encoding.js';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

function requireMedia(env) {
  if (!env.MEDIA) {
    throw serviceUnavailable('图片上传未启用：请先在 Cloudflare 控制台开通 R2 并配置 MEDIA 绑定');
  }
  return env.MEDIA;
}

export function registerUploadRoutes(router) {
  // 上传图片到 R2
  router.post('/api/uploads', async (ctx) => {
    const { env, request } = ctx;
    const user = requireUser(ctx);
    await rateLimit(env, `upload:${user.id}`, 30, 3600);

    const media = requireMedia(env);

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      throw badRequest('请使用 multipart/form-data 上传文件');
    }

    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') throw badRequest('缺少上传文件（字段名 file）');

    const ext = ALLOWED[file.type];
    if (!ext) throw badRequest('仅支持 PNG / JPEG / WebP / GIF 图片');
    if (file.size > MAX_SIZE) throw badRequest('文件不能超过 5MB');

    const key = `uploads/${user.id}/${Date.now()}-${randomHex(8)}.${ext}`;
    await media.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' }
    });

    return created({ url: `/media/${key}`, key, size: file.size, contentType: file.type });
  });

  // 从 R2 读取媒体
  router.get('/media/*', async (ctx) => {
    const { env, params } = ctx;
    const key = params.wildcard;
    if (!key) throw notFound('文件不存在');

    const object = await requireMedia(env).get(key);
    if (!object) throw notFound('文件不存在');

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');

    return withHeaders(object.body, { headers });
  });
}