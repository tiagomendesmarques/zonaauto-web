// Utilitários de texto do blog.

// Minúsculas, sem acentos e com espaços simples ("Café" → "cafe").
function normalizeText(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|h\d|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#8217;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Início do texto, cortado numa palavra inteira.
function excerpt(html, max = 220) {
  const t = stripHtml(html).replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  return t.slice(0, t.lastIndexOf(' ', max)).replace(/[,.;:]$/, '') + '…';
}

function slugify(input) {
  return String(input || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { normalizeText, stripHtml, excerpt, slugify };
