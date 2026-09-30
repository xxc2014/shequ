// 客户端 Markdown 渲染：先转义再套标记，防注入
export function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, '<a href="$2" rel="noopener">$1</a>');
}

export function renderMarkdown(markdown) {
  const lines = escapeHtml(markdown || '').split('\n');
  const html = [];
  let inCode = false;
  let inList = false;
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (inList) { html.push('</ul>'); inList = false; }
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (/^```/.test(line)) {
      flushParagraph(); closeList();
      html.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode; continue;
    }
    if (inCode) { html.push(line); continue; }
    if (!line.trim()) { flushParagraph(); closeList(); continue; }

    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushParagraph(); closeList();
      const level = m[1].length;
      html.push(`<h${level}>${inline(m[2])}</h${level}>`); continue;
    }
    if (/^(---|\*\*\*)\s*$/.test(line)) { flushParagraph(); closeList(); html.push('<hr>'); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { flushParagraph(); closeList(); html.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    if ((m = line.match(/^[-*]\s+(.*)$/)) || (m = line.match(/^(\d+)\.\s+(.*)$/))) {
      flushParagraph();
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${inline(m[2] !== undefined ? m[2] : m[1])}</li>`); continue;
    }
    paragraph.push(line.trim());
  }

  flushParagraph(); closeList();
  if (inCode) html.push('</code></pre>');
  return html.join('\n');
}

export function stripMarkdown(markdown, maxLength = 160) {
  const text = String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}