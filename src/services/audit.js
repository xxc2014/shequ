// 管理操作审计日志
export async function audit(env, { actorId = null, action, targetType = '', targetId = 0, meta = null, ip = '' }) {
  try {
    await env.DB.prepare(
      'INSERT INTO audit_logs (actor_id, action, target_type, target_id, meta, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(
        actorId,
        action,
        targetType,
        targetId,
        meta ? JSON.stringify(meta) : '',
        ip,
        Math.floor(Date.now() / 1000)
      )
      .run();
  } catch (err) {
    console.error('audit log failed', err);
  }
}