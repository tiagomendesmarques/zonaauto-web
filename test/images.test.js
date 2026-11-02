const test = require('node:test');
const assert = require('node:assert/strict');
const { imageSource, unsplashSized, ImageError } = require('../src/blog/images');
const { sanitizeContentHtml } = require('../src/blog/html');

test('anfitriões permitidos e recusados', () => {
  assert.equal(imageSource('https://images.pexels.com/photos/1/a.jpeg').mode, 'copy');
  assert.equal(imageSource('https://images.unsplash.com/photo-1').mode, 'link');
  assert.equal(imageSource('https://plus.unsplash.com/premium_photo-1').mode, 'link');
  assert.throws(() => imageSource('http://images.pexels.com/photos/1/a.jpeg'), ImageError);
  assert.throws(() => imageSource('https://example.com/a.jpg'), ImageError);
  assert.throws(() => imageSource('https://169.254.169.254/latest'), ImageError);
  assert.throws(() => imageSource('isto não é um url'), ImageError);
});

test('banco de imagens falso só fora de produção', () => {
  process.env.BLOG_IMAGE_TEST_ORIGIN = 'http://127.0.0.1:9999';
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  assert.equal(imageSource('http://127.0.0.1:9999/a.jpg').mode, 'copy');
  process.env.NODE_ENV = 'production';
  assert.throws(() => imageSource('http://127.0.0.1:9999/a.jpg'), ImageError);
  process.env.NODE_ENV = prev;
  delete process.env.BLOG_IMAGE_TEST_ORIGIN;
});

test('tamanhos do Unsplash mantêm os parâmetros existentes', () => {
  const u = new URL(unsplashSized('https://images.unsplash.com/photo-1?ixid=abc&w=50', 800));
  assert.equal(u.searchParams.get('ixid'), 'abc');
  assert.equal(u.searchParams.get('w'), '800');
  assert.equal(u.searchParams.get('q'), '80');
  assert.equal(u.searchParams.get('auto'), 'format');
  assert.equal(u.searchParams.get('fit'), 'max');
});

test('HTML: só passa o permitido; ligações externas com nofollow; imagens lazy', () => {
  const out = sanitizeContentHtml('<p onclick="x()">Olá<script>alert(1)</script> <a href="https://imt-ip.pt/">IMT</a> <a href="/stock/">stock</a> <a href="javascript:alert(1)">x</a></p><img src="/media/blog/a-800.webp" alt="a" style="x"><iframe src="https://x"></iframe>');
  assert.ok(!out.includes('script') && !out.includes('onclick') && !out.includes('iframe') && !out.includes('style'));
  assert.ok(out.includes('<a href="https://imt-ip.pt/" rel="noopener nofollow" target="_blank">'));
  assert.ok(out.includes('<a href="/stock/">stock</a>'));
  assert.ok(!out.includes('javascript:'));
  assert.ok(out.includes('loading="lazy"'));
});
