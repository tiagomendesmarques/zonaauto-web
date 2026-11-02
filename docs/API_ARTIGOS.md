# API de artigos da Zona Auto

Para criar, corrigir, publicar e apagar artigos do blog a partir de outro programa (por exemplo, uma tarefa agendada do Claude). Não há back-office: tudo se faz por aqui.

- **Endereço:** `https://zonaauto.pt/api/v1/artigos/` (termina sempre em `/`).
- **Chave:** cabeçalho `Authorization: Bearer <chave>`. A chave está no Secret Manager (`zonaauto-blog-api-token`). Para a ver: `gcloud secrets versions access latest --secret=zonaauto-blog-api-token`. Sem chave, ou com a chave errada, a resposta é `401`.
- **Formato:** JSON (`Content-Type: application/json`), até 1 MB por pedido, 300 pedidos por hora.
- **Erros:** `{ "error": "…", "details": [...] }` ou `{ "error": "…", "seo": {...} }`, sempre em português.

## Pedidos

| Pedido | Para quê | Respostas |
|---|---|---|
| `GET /api/v1/artigos/contexto/` | O que é preciso saber antes de escrever (ver abaixo) | 200 |
| `POST /api/v1/artigos/` | Criar um artigo | 201 criado · 200 já existia (mesma `Idempotency-Key`) · 400 campos inválidos · 409 endereço em uso · 422 erros de SEO ou de imagem |
| `GET /api/v1/artigos/` | Os últimos 50 artigos (sem o texto) | 200 |
| `GET /api/v1/artigos/{id}/` | Um artigo, com a pontuação SEO atual | 200 · 404 |
| `PATCH /api/v1/artigos/{id}/` | Corrigir, publicar ou despublicar; só muda os campos enviados | 200 · 400 · 404 · 409 · 422 |
| `DELETE /api/v1/artigos/{id}/` | Apagar um artigo | 200 · 404 |

**Redirects automáticos** (para nunca haver páginas partidas no Google):
- mudar o endereço de um artigo publicado: o endereço antigo passa a levar ao novo (301);
- despublicar (`"status": "draft"`) ou apagar um artigo publicado: o endereço passa a levar ao `/blog/` (301).

### `GET /contexto/`
```json
{
  "usedKeywords": ["comprar carro usado", "..."],
  "posts": [{ "title": "...", "url": "/blog/comprar-carro-usado/", "focusKeyword": "..." }],
  "pages": [{ "title": "Stock de viaturas", "url": "/stock/" }, { "title": "Importação de carros por encomenda", "url": "/importacao/" }],
  "usefulLinks": [{ "title": "Stock de viaturas", "url": "/stock/" }],
  "makes": [{ "name": "Toyota", "url": "/stock/?marca=Toyota" }],
  "cars": [{ "title": "Volvo V60 2018", "price": 17990, "url": "/stock/volvo-v60-2018-8q16k1/" }],
  "notes": ["As viaturas saem do stock quando são vendidas. Para ligações que duram, prefira /stock/ ou /stock/?marca=…"],
  "imageHosts": { "images.pexels.com": "copiada para o site", "images.unsplash.com": "fica no Unsplash (creditar o fotógrafo)" },
  "limits": { "titleMin": 10, "titleMax": 100, "seoTitleIdeal": 60, "seoTitleMax": 70, "seoDescriptionMin": 70, "seoDescriptionIdeal": 155, "seoDescriptionMax": 170, "minWords": 300 }
}
```

As ligações internas de um artigo só podem apontar para endereços que existam no site: as páginas acima, o stock, cada viatura em stock e os artigos publicados. O que vem depois de `?` ou `#` é ignorado na verificação (`/stock/?marca=Toyota` conta como `/stock/`).

## Campos de um artigo

| Campo | Obrigatório no POST | Regras |
|---|---|---|
| `title` | sim | 10 a 100 caracteres. É o `<h1>` da página. |
| `focusKeyword` | sim | A palavra-chave principal (2 a 100 caracteres). |
| `contentHtml` | sim | HTML simples: `<p> <h2> <h3> <ul> <ol> <li> <strong> <em> <a> <img> <blockquote> <table>`. **Sem `<h1>`.** Mínimo 300 palavras. Cada `<img>` precisa de `alt`. |
| `slug` | não | Endereço (`/blog/{slug}/`). Vazio = gerado do título. `page` e `feed` estão reservados. |
| `status` | não | `"draft"` (por omissão) ou `"published"`. |
| `secondaryKeywords` | não | Até 10. |
| `seoTitle` | não | Título para o Google: ideal 30 a 60 caracteres, máximo 70. Vazio = `title`. |
| `seoDescription` | não | Descrição para o Google: ideal 70 a 155, máximo 170. |
| `excerpt` | não | Resumo para a lista do blog (até 300). Vazio = início do texto. |
| `featuredImage` | não | `{ "url", "alt", "caption"?, "credit"?, "creditUrl"? }`. `alt` obrigatório (5 a 200). Só `images.pexels.com` ou `images.unsplash.com`. No PATCH, `null` tira a imagem. |
| `faq` | não | `[{ "question", "answer" }]`, até 15. Aparecem no fim do artigo e nos dados estruturados `FAQPage`. |
| `sources` | não | `[{ "title", "url" }]`, até 15. Secção "Fontes" no fim do artigo. |
| `tags` | não | Até 10 etiquetas. |

Campos desconhecidos são recusados (`400`), para apanhar erros de escrita.

**Imagens:**
- **Pexels** (`images.pexels.com`): o site descarrega e guarda uma cópia em WebP (400, 800 e 1600 px).
- **Unsplash** (`images.unsplash.com`): fica nos servidores do Unsplash, como as regras da API deles exigem, e o site pede-lhes os tamanhos. Quem usa a API do Unsplash tem de chamar o `links.download_location` da foto quando a usa.
- **Créditos:** em `credit` e `creditUrl`, por exemplo `"Foto: Ana Silva / Pexels"` com o link do fotógrafo.
- **Imagens dentro do texto** (`<img src="https://images.pexels.com/…" alt="…">`) seguem as mesmas regras.
- Imagens de outros sítios, endereços `http://` ou com redirects são recusados (`422`).

**Cabeçalho `Idempotency-Key`** (opcional, no POST, até 100 caracteres): se o mesmo pedido for repetido com a mesma chave (por exemplo, depois de uma falha de rede), devolve o artigo já criado em vez de criar outro.

## Pontuação SEO

Cada resposta traz `seo` com `score`, `errors`, `warnings` e `stats`:
- `score`: 0 a 100.
- `errors`: impedem gravar; a resposta é `422` e nada fica guardado (nem as imagens são descarregadas).
- `warnings`: baixam a nota.
- `stats`: palavras, intertítulos, ligações, imagens, perguntas, densidade da palavra-chave.

**Erros:** título fora de 10–100 caracteres, menos de 300 palavras, `<h1>` no texto, imagem sem `alt`, título para o Google acima de 70, descrição acima de 170, ligações internas para páginas que não existem, perguntas frequentes incompletas.

**O que dá pontos:**
- palavra-chave no título, no título para o Google, na descrição, no endereço, no primeiro parágrafo e num `<h2>`;
- densidade da palavra-chave entre 0,5% e 2,5%;
- título para o Google com 30 a 60 caracteres e descrição com 70 a 155;
- 900 palavras ou mais (melhor com 1200);
- 3 ou mais `<h2>`;
- 3 ou mais ligações internas e 1 ou mais externas;
- imagem de destaque;
- 3 ou mais perguntas frequentes;
- resumo;
- parágrafos até 150 palavras.

## O que o site gera sozinho
- `<title>`, `<meta name="description">`, `canonical` e `keywords`.
- Open Graph (`og:type=article`, `og:image` com `alt`, datas e etiquetas) e Twitter `summary_large_image`.
- Dados estruturados `BlogPosting` (autor "Equipa Zona Auto", editor com logótipo) e `FAQPage`.
- Imagem com `alt`, legenda e crédito, em três tamanhos (`srcset`).
- Entrada no `sitemap.xml` e no RSS (`/feed/`).
- "Blog" no menu do site, quando houver pelo menos um artigo publicado.
- Na página do artigo: convite para ver o stock e falar no WhatsApp, e três carros do stock atual.

## Exemplo
```bash
curl -sS -X POST https://zonaauto.pt/api/v1/artigos/ \
  -H "Authorization: Bearer $ZONAAUTO_BLOG_TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: comprar-carro-usado-2026-11-03" \
  -d '{
    "title": "Comprar carro usado: o que verificar antes de assinar",
    "focusKeyword": "comprar carro usado",
    "secondaryKeywords": ["carro usado com garantia"],
    "seoTitle": "Comprar carro usado: 8 coisas a verificar",
    "seoDescription": "Documentos, quilómetros, inspeção e garantia: o que confirmar antes de comprar carro usado para não ter surpresas.",
    "excerpt": "Os pontos a confirmar antes de comprar carro usado.",
    "contentHtml": "<p>Comprar carro usado …</p><h2>…</h2><p>Veja o <a href=\"/stock/\">stock</a> …</p>",
    "featuredImage": { "url": "https://images.pexels.com/photos/…/pexels-photo-….jpeg?auto=compress&cs=tinysrgb&w=1600", "alt": "Carro usado num stand", "credit": "Foto: Nome do fotógrafo / Pexels", "creditUrl": "https://www.pexels.com/@fotografo" },
    "faq": [{ "question": "Os carros usados têm garantia?", "answer": "…" }],
    "sources": [{ "title": "Portal do Consumidor", "url": "https://www.consumidor.gov.pt/" }],
    "tags": ["carros usados", "guias"],
    "status": "draft"
  }'
```
Resposta (`201`):
```json
{ "id": 12, "status": "draft", "slug": "comprar-carro-usado-o-que-verificar-antes-de-assinar",
  "url": "https://zonaauto.pt/blog/comprar-carro-usado-o-que-verificar-antes-de-assinar/",
  "seo": { "score": 91, "errors": [], "warnings": ["…"], "stats": { "words": 1240, "h2": 6, "internalLinks": 4, "externalLinks": 2, "images": 1, "faq": 4, "keywordDensity": 1.1 } } }
```
Publicar depois: `PATCH /api/v1/artigos/12/` com `{ "status": "published" }`.

## Testes
- Unitários: `npm test` (pontuação SEO, imagens, limpeza do HTML).
- Ponta a ponta: com o emulador do Firestore a correr (`gcloud emulators firestore start --host-port=127.0.0.1:8085`), `npm run e2e` (55 verificações, com um banco de imagens falso).
