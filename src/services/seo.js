// 服务端渲染辅助：SEO 元信息注入、RSS、站点地图
import { escapeXml } from '../lib/markdown.js';
import { readEmbeddedAsset } from '../lib/embedded-assets.js';

const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'public, max-age=60, s-maxage=300'
};

function baseUrl(env, request) {
  return (env.SITE_URL && env.SITE_URL !== 'http://localhost:8787'
    ? env.SITE_URL.replace(/\/$/, '')
    : new URL(request.url).origin);
}

function metaBlock({ title, description, canonical, image, type, publishedAt }) {
  const tags = [
    `<title>${escapeXml(title)}</title>`,
    `<meta name="description" content="${escapeXml(description)}">`,
    `<link rel="canonical" href="${escapeXml(canonical)}">`,
    `<meta property="og:type" content="${escapeXml(type)}">`,
    `<meta property="og:title" content="${escapeXml(title)}">`,
    `<meta property="og:description" content="${escapeXml(description)}">`,
    `<meta property="og:url" content="${escapeXml(canonical)}">`,
    `<meta name="twitter:card" content="summary_large_image">`
  ];
  if (image) {
    tags.push(`<meta property="og:image" content="${escapeXml(image)}">`);
    tags.push(`<meta name="twitter:image" content="${escapeXml(image)}">`);
  }
  if (publishedAt) {
    tags.push(`<meta property="article:published_time" content="${new Date(publishedAt * 1000).toISOString()}">`);
  }
  return tags.join('\n    ');
}

// 取 index.html 外壳并注入 SEO 信息（客户端会接管后续渲染）
export async function renderShell(env, request, seo) {
  const assetUrl = new URL('/index.html', new URL(request.url).origin);
  let html;
  if (env.ASSETS) {
    const asset = await env.ASSETS.fetch(new Request(assetUrl.toString(), { headers: request.headers }));
    html = await asset.text();
  } else {
    // 未绑定 Cloudflare 静态资源时复用内嵌外壳，保证单脚本部署可用
    html = (await readEmbeddedAsset('/index.html')) || '';
  }

  const siteName = env.SITE_NAME || 'DevHub';
  const fullTitle = seo.title ? `${seo.title} · ${siteName}` : siteName;
  const block = metaBlock({ ...seo, title: fullTitle });

  if (html.includes('<!--SEO-->')) {
    html = html.replace('<!--SEO-->', block);
  } else {
    html = html.replace('</head>', `${block}\n  </head>`);
  }
  if (seo.jsonLd) {
    html = html.replace('</head>', `<script type="application/ld+json">${JSON.stringify(seo.jsonLd)}</script>\n  </head>`);
  }

  return new Response(html, { status: seo.status || 200, headers: HTML_HEADERS });
}

export async function renderRss(env, request) {
  const site = baseUrl(env, request);
  const siteName = env.SITE_NAME || 'DevHub';
  const rows = await env.DB.prepare(
    `SELECT slug, title, summary, body, published_at FROM blog_posts
     WHERE status = 'published' ORDER BY published_at DESC LIMIT 30`
  ).all();

  const items = (rows.results || [])
    .map((p) => {
      const link = `${site}/blog/${p.slug}`;
      return `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${new Date((p.published_at || 0) * 1000).toUTCString()}</pubDate>
      <description>${escapeXml(p.summary || '')}</description>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(siteName)} 官方博客</title>
    <link>${escapeXml(site)}/blog</link>
    <description>${escapeXml(env.SITE_DESCRIPTION || '')}</description>
    <language>zh-CN</language>
    <atom:link href="${escapeXml(site)}/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' }
  });
}

export async function renderSitemap(env, request) {
  const site = baseUrl(env, request);
  const [threads, posts] = await Promise.all([
    env.DB.prepare("SELECT id, updated_at FROM threads WHERE status = 'published' ORDER BY id DESC LIMIT 5000").all(),
    env.DB.prepare("SELECT slug, updated_at FROM blog_posts WHERE status = 'published' ORDER BY id DESC LIMIT 5000").all()
  ]);

  const staticUrls = ['/', '/forum', '/blog', '/search'].map(
    (p) => `  <url><loc>${escapeXml(site + p)}</loc></url>`
  );
  const threadUrls = (threads.results || []).map(
    (t) => `  <url><loc>${escapeXml(`${site}/t/${t.id}`)}</loc><lastmod>${new Date(t.updated_at * 1000).toISOString()}</lastmod></url>`
  );
  const postUrls = (posts.results || []).map(
    (p) => `  <url><loc>${escapeXml(`${site}/blog/${p.slug}`)}</loc><lastmod>${new Date(p.updated_at * 1000).toISOString()}</lastmod></url>`
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticUrls, ...postUrls, ...threadUrls].join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' }
  });
}

// robots.txt 动态生成（引用 sitemap）
export async function renderRobots(env, request) {
  const site = baseUrl(env, request);
  const body = `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\n\nSitemap: ${site}/sitemap.xml\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
}