// 站内通知：回复、@提及、点赞、系统与博客更新
export async function createNotification(env, { userId, actorId = null, type, title, body = '', link = '' }) {
  if (!userId) return;
  if (actorId && actorId === userId) return; // 不给自己发通知
  await env.DB.prepare(
    'INSERT INTO notifications (user_id, actor_id, type, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(userId, actorId, type, title, body.slice(0, 500), link, Math.floor(Date.now() / 1000))
    .run();
}

// 从正文中解析 @用户名 并通知（排除重复与自己）
export async function notifyMentions(env, body, { actorId, link, title }) {
  const mentions = new Set();
  const re = /@([a-zA-Z0-9_]{3,24})/g;
  let m;
  while ((m = re.exec(body || '')) !== null) mentions.add(m[1]);
  if (!mentions.size) return;

  const placeholders = [...mentions].map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT id, username FROM users WHERE username IN (${placeholders}) AND status = 'active'`
  )
    .bind(...mentions)
    .all();

  await Promise.all(
    (rows.results || []).map((u) =>
      createNotification(env, {
        userId: u.id,
        actorId,
        type: 'mention',
        title,
        body: '',
        link
      })
    )
  );
}