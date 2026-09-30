// 把 public/ 下的前端资源压缩内嵌为 Worker 模块，用于无法使用 Cloudflare 静态资源托管
// （绑定 env.ASSETS）时仍能独立提供页面。生成物：src/generated/assets.js
//
// 为控制 Worker 脚本体积：先压缩 JS/CSS，再 gzip 整体并 base64 编码，运行时解压。
//
// 用法：node scripts/build-assets.mjs
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, relative, extname, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { transform } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(root, 'public');
const outFile = join(root, 'src', 'generated', 'assets.js');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

// 压缩源代码型资源；二进制资源保持原样
async function optimize(file, buf) {
  const ext = extname(file).toLowerCase();
  const text = buf.toString('utf8');
  try {
    if (ext === '.js' || ext === '.mjs') {
      return Buffer.from((await transform(text, { loader: 'js', minify: true })).code);
    }
    if (ext === '.css') {
      return Buffer.from((await transform(text, { loader: 'css', minify: true })).code);
    }
  } catch {
    return buf;
  }
  return buf;
}

// 解析 Cloudflare _headers：规则文件本身不作为资源提供
function parseHeaderRules(text) {
  const rules = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), headers: {} };
      rules.push(current);
      continue;
    }
    if (!current) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    current.headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return rules;
}

const files = (await walk(publicDir)).filter((f) => !f.endsWith(`${sep}_headers`));

const assets = {};
let rawTotal = 0;
let optimizedTotal = 0;
for (const file of files) {
  const rel = '/' + relative(publicDir, file).split(sep).join(posix.sep);
  const original = await readFile(file);
  const optimized = await optimize(file, original);
  rawTotal += original.byteLength;
  optimizedTotal += optimized.byteLength;
  assets[rel] = {
    t: TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    d: optimized.toString('base64')
  };
}

let headerRules = [];
try {
  headerRules = parseHeaderRules(await readFile(join(publicDir, '_headers'), 'utf8'));
} catch {
  // 没有 _headers 时使用默认安全头
}

const json = JSON.stringify(assets);
const compressed = gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
const payloadB64 = compressed.toString('base64');

const banner = `// 本文件由 scripts/build-assets.mjs 自动生成，请勿手工修改。\n// 数据来源：public/（前端资源压缩后 gzip + base64 内嵌，运行时解压）\n`;
const out = `${banner}export const ASSETS_GZIP_B64 = ${JSON.stringify(payloadB64)};\n\nexport const EMBEDDED_HEADER_RULES = ${JSON.stringify(headerRules, null, 0)};\n`;

await mkdir(join(root, 'src', 'generated'), { recursive: true });
await writeFile(outFile, out, 'utf8');

console.log(
  `已内嵌 ${Object.keys(assets).length} 个资源：原始 ${rawTotal} B → 压缩后 ${optimizedTotal} B → gzip ${compressed.byteLength} B → 内嵌载荷 ${payloadB64.length} B`
);