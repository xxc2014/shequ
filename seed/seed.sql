-- DevHub 种子数据（可重复执行，使用 INSERT OR IGNORE + 固定 ID）
-- 管理员默认密码：admin12345（登录后请立即修改）
-- 生成新密码哈希：node scripts/hash-password.mjs "新密码"

-- ============ 站点设置 ============
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('site_name', 'DevHub 技术社区'),
  ('site_description', '面向开发者的技术交流社区与官方博客'),
  ('announcement', '欢迎来到 DevHub！发帖前请先阅读社区规范，友善交流。'),
  ('registration_open', 'true');

-- ============ 用户 ============
INSERT OR IGNORE INTO users (id, username, email, password_hash, display_name, avatar_url, bio, role, status, created_at, updated_at, last_seen_at) VALUES
  (1, 'admin', 'admin@devhub.local',
   'pbkdf2$100000$sVGS-prQv4zMq2tUVkjmPw$pGSl0zAZPQfBwRVYDSmM6Oti8k3AqiSYINp4VAbAd3Y',
   '社区管理员', '', 'DevHub 官方运营账号，负责社区治理与官方内容发布。',
   'admin', 'active', CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER), 0),
  (2, 'alice', 'alice@devhub.local',
   'pbkdf2$100000$sVGS-prQv4zMq2tUVkjmPw$pGSl0zAZPQfBwRVYDSmM6Oti8k3AqiSYINp4VAbAd3Y',
   'Alice', '', '前端工程师，热爱性能优化与设计系统。',
   'member', 'active', CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER), 0),
  (3, 'bob', 'bob@devhub.local',
   'pbkdf2$100000$sVGS-prQv4zMq2tUVkjmPw$pGSl0zAZPQfBwRVYDSmM6Oti8k3AqiSYINp4VAbAd3Y',
   'Bob', '', '后端 / 云原生方向，最近在研究边缘计算。',
   'moderator', 'active', CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER), 0);

-- ============ 论坛版块 ============
INSERT OR IGNORE INTO categories (id, slug, name, description, icon, sort_order, created_at) VALUES
  (1, 'announcements', '公告与规则', '官方公告、社区规范与活动通知', '📢', 10, CAST(strftime('%s','now') AS INTEGER)),
  (2, 'general', '综合讨论', '技术闲聊、经验分享与开放话题', '💬', 20, CAST(strftime('%s','now') AS INTEGER)),
  (3, 'frontend', '前端开发', 'HTML/CSS/JS、框架、工程化与性能', '🎨', 30, CAST(strftime('%s','now') AS INTEGER)),
  (4, 'backend', '后端与架构', '服务端、数据库、分布式与云原生', '⚙️', 40, CAST(strftime('%s','now') AS INTEGER)),
  (5, 'cloudflare', '边缘与 Cloudflare', 'Workers、D1、R2、Pages 等实践交流', '☁️', 50, CAST(strftime('%s','now') AS INTEGER)),
  (6, 'career', '求职与成长', '面试、简历、职业发展讨论', '🚀', 60, CAST(strftime('%s','now') AS INTEGER));

-- ============ 标签 ============
INSERT OR IGNORE INTO tags (id, slug, name, use_count) VALUES
  (1, 'javascript', 'JavaScript', 0),
  (2, 'cloudflare-workers', 'Cloudflare Workers', 0),
  (3, 'performance', '性能优化', 0),
  (4, 'database', '数据库', 0),
  (5, 'career', '职业发展', 0),
  (6, 'release', '产品发布', 0),
  (7, 'best-practices', '最佳实践', 0);

-- ============ 博客分类 ============
INSERT OR IGNORE INTO blog_categories (id, slug, name, description) VALUES
  (1, 'product', '产品动态', 'DevHub 平台功能更新与路线图'),
  (2, 'engineering', '工程实践', '来自团队的一线技术实践与踩坑记录'),
  (3, 'tutorial', '教程指南', '手把手教程与上手指南');

-- ============ 示例帖子 ============
INSERT OR IGNORE INTO threads (id, category_id, author_id, title, body, is_pinned, status, view_count, reply_count, like_count, last_reply_at, created_at, updated_at) VALUES
  (1, 1, 1, 'DevHub 社区规范（新人必读）',
   '# 社区规范

欢迎加入 DevHub！为了维护良好的技术交流氛围，请遵守以下规范：

1. **友善交流**：就事论事，不人身攻击。
2. **内容相关**：发帖请选择合适版块并打上标签。
3. **禁止广告**：未经允许不得发布推广内容。
4. **保护隐私**：不要公开他人隐私信息。

违规内容将被移除，严重者封禁账号。',
   1, 'published', 128, 1, 5, CAST(strftime('%s','now') AS INTEGER),
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),
  (2, 5, 3, '用 Workers + D1 + R2 搭建社区站点的架构笔记',
   '最近把一个小社区站迁到 Cloudflare 全栈方案上，记录一下架构：

- **Workers** 负责 API 与动态路由，静态资源直接用 Assets 托管
- **D1** 存用户、帖子、评论，SQLite 语义，本地开发用 wrangler dev 即可
- **KV** 做会话缓存、登录限流与热榜缓存
- **R2** 存头像和文章配图，零出口流量费

关键点：D1 一定要用预处理语句 bind()，别拼字符串。

有人想一起讨论下分页和热榜的实现吗？',
   0, 'published', 96, 1, 8, CAST(strftime('%s','now') AS INTEGER),
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),
  (3, 3, 2, '你们现在怎么做前端性能预算的？',
   '我们团队最近在推性能预算（performance budget），想听听大家的做法：

- LCP / CLS / INP 分别卡在多少？
- 是在 CI 里卡还是靠监控告警？
- 有没有用 Lighthouse CI？

求经验，感谢！',
   0, 'published', 54, 0, 3, 0,
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER));

INSERT OR IGNORE INTO thread_tags (thread_id, tag_id) VALUES
  (1, 7), (2, 2), (2, 4), (3, 1), (3, 3);

INSERT OR IGNORE INTO replies (id, thread_id, author_id, parent_id, body, status, like_count, created_at, updated_at) VALUES
  (1, 1, 2, NULL, '已读，规范写得很清楚，支持！', 'published', 1,
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),
  (2, 2, 1, NULL, '热榜可以用 KV 缓存一个按热度排序的 ID 列表，定时任务刷新，读的时候再回表查详情，效果不错。', 'published', 2,
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER));

-- ============ 示例博客文章 ============
INSERT OR IGNORE INTO blog_posts (id, author_id, category_id, title, slug, summary, body, cover_image, status, featured, view_count, like_count, published_at, created_at, updated_at) VALUES
  (1, 1, 1, 'DevHub 正式上线：一个面向开发者的技术社区',
   'devhub-launch',
   '我们正式发布 DevHub——集技术论坛与官方博客于一体的开发者社区平台。',
   '# 欢迎来到 DevHub

今天我们正式发布 **DevHub**。它是一个把「技术交流社区」和「官方博客」合二为一的平台。

## 你会在这里看到什么

- 分版块的技术讨论，支持标签、点赞与楼中楼回复
- 官方博客：产品动态、工程实践与教程
- 站内通知与全文搜索

## 技术栈

站点构建在 Cloudflare 全栈之上：Workers 提供 API，D1 存数据，KV 做缓存，R2 存媒体。

欢迎在论坛里告诉我们你希望看到的功能！',
   '', 'published', 1, 42, 6,
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)),
  (2, 1, 2, 'D1 使用避坑：预处理语句、迁移与本地开发',
   'd1-best-practices',
   '整理我们在生产环境使用 Cloudflare D1 的十条实践经验。',
   '# D1 实战经验

## 1. 永远使用预处理语句

await env.DB.prepare(''SELECT * FROM users WHERE email = ?'').bind(email).first();

## 2. 用迁移管理表结构

wrangler d1 migrations create devhub-db add_index
wrangler d1 migrations apply devhub-db --local

## 3. 本地开发默认走本地 SQLite

wrangler dev 无需联网即可开发。

## 4. 批量写入用 batch()

batch() 是原子事务，比逐条写更省往返。

## 5. 注意行大小与查询超时

单行 1MB 上限，查询 30 秒超时，长任务考虑拆批。',
   '', 'published', 0, 31, 4,
   CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER));

INSERT OR IGNORE INTO blog_post_tags (post_id, tag_id) VALUES
  (1, 6), (2, 2), (2, 4), (2, 7);

-- 修正标签使用计数
UPDATE tags SET use_count = (
  SELECT COUNT(*) FROM thread_tags tt WHERE tt.tag_id = tags.id
) + (
  SELECT COUNT(*) FROM blog_post_tags bt WHERE bt.tag_id = tags.id
);

-- ============ 全文检索索引 ============
DELETE FROM search_index;
INSERT INTO search_index (title, body, kind, ref_id, url)
  SELECT title, body, 'thread', id, '/t/' || id FROM threads WHERE status = 'published';
INSERT INTO search_index (title, body, kind, ref_id, url)
  SELECT title, summary || ' ' || body, 'post', id, '/blog/' || slug FROM blog_posts WHERE status = 'published';