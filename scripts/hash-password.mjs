// 生成与 Worker 端 src/lib/password.js 完全一致的 PBKDF2 密码哈希
// 用法: node scripts/hash-password.mjs "你的密码"
const ITERATIONS = 100000;
const KEY_LEN = 32;

const password = process.argv[2];
if (!password) {
  console.error('用法: node scripts/hash-password.mjs "<password>"');
  process.exit(1);
}

const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
  key,
  KEY_LEN * 8
);

const b64 = (buf) => Buffer.from(buf).toString('base64url');
console.log(`pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(new Uint8Array(bits))}`);