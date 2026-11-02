// Limpeza do HTML dos artigos: só o que está na lista de permissões passa.
const sanitizeHtml = require('sanitize-html');

const isExternal = (href) => /^https?:\/\//i.test(href || '') && !/^https?:\/\/(www\.)?zonaauto\.pt/i.test(href || '');

function sanitizeContentHtml(html) {
  return sanitizeHtml(html || '', {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'figure', 'figcaption', 'h1', 'h2']),
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading'],
      '*': ['id'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName: 'a',
        attribs: isExternal(attribs.href) ? { ...attribs, rel: 'noopener nofollow', target: '_blank' } : attribs,
      }),
      img: (tagName, attribs) => ({ tagName: 'img', attribs: { ...attribs, loading: 'lazy' } }),
    },
  });
}

module.exports = { sanitizeContentHtml };
