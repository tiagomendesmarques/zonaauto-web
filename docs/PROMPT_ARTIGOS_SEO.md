# Tarefa diária: um artigo SEO por dia no blog da Zona Auto

Tarefa agendada do Claude que, todos os dias, escreve e publica um artigo no blog através da API de artigos (`docs/API_ARTIGOS.md`).

## O que a tarefa precisa (no ambiente do Claude Code)

Menu do ambiente, na barra do título da sessão → Edit:

- **Variáveis de ambiente / Network secrets** (nunca colar estas chaves no chat):
  - `ZONAAUTO_BLOG_TOKEN`: a chave da API de artigos. Para a ver, no Cloud Shell: `gcloud secrets versions access latest --secret=zonaauto-blog-api-token`.
  - `PEXELS_API_KEY`: chave grátis em https://www.pexels.com/api/ ("Get started").
  - `UNSPLASH_ACCESS_KEY`: chave grátis em https://unsplash.com/developers ("New Application" → "Access Key").
- **Rede:** `zonaauto.pt`, `api.pexels.com`, `images.pexels.com`, `api.unsplash.com`, `images.unsplash.com`.
- **Conector:** Google Sheets (para ler as palavras-chave e atualizar a memória e as imagens usadas).

## Folha de cálculo

https://docs.google.com/spreadsheets/d/1KWSUmCMXsHEgwEqfieKtEWYwPXPWTCQZsnes3LCDwDI

| Separador | Para quê |
|---|---|
| `keywords-prod` | Uma palavra-chave por linha, na coluna A. O artigo N usa a linha N. |
| `memory` | `A1` = número do último artigo publicado. Para recomeçar ou saltar, mudar este número à mão. |
| `imagens-usadas` | Uma linha por imagem usada (chave, ficheiro, banco, fotógrafo, página da foto, artigo N, id no site, palavra-chave, data, notas). Nenhuma imagem se repete. |

## Agendamento

Todos os dias às 6h37 de Lisboa (`CRON_TZ=Europe/Lisbon 37 6 * * *`), numa sessão nova, com o texto abaixo.

## Texto da tarefa

Escreve e publica o próximo artigo do blog da Zona Auto (https://zonaauto.pt), um stand de carros usados em Lisboa, em português de Portugal, usando a API de artigos.

**Chaves (variáveis de ambiente; nunca as mostres, escrevas nem copies para lado nenhum):** `$ZONAAUTO_BLOG_TOKEN` (API do blog), `$PEXELS_API_KEY`, `$UNSPLASH_ACCESS_KEY`.

**API do blog** (base `https://zonaauto.pt/api/v1/artigos/`, sempre com `/` no fim; cabeçalho `Authorization: Bearer $ZONAAUTO_BLOG_TOKEN`; JSON):
- `GET contexto/` → `usedKeywords`, `posts`, `pages`, `usefulLinks`, `makes`, `cars`, `notes`, `limits`.
- `POST` (criar) → campos: `title` (10–100), `focusKeyword`, `contentHtml` (HTML sem `<h1>`, mínimo 300 palavras, cada `<img>` com `alt`), `slug`, `status` (`draft`/`published`), `secondaryKeywords` (≤10), `seoTitle` (≤70), `seoDescription` (≤170), `excerpt` (≤300), `featuredImage` `{url, alt, caption?, credit?, creditUrl?}` (só `images.pexels.com` ou `images.unsplash.com`), `faq` `[{question, answer}]` (≤15), `sources` `[{title, url}]` (≤15), `tags` (≤10). Campos desconhecidos dão 400. Cabeçalho opcional `Idempotency-Key`.
- `PATCH {id}/` → muda só os campos enviados. `GET {id}/` → artigo com a pontuação SEO atual.
- Respostas: 201 criado; 400 campos inválidos (`details`); 409 endereço em uso (`existingId`); 422 erros de SEO ou de imagem (`seo.errors` ou `error`). Cada resposta de sucesso traz `id`, `url` e `seo { score, errors, warnings, stats }`.
- As ligações internas só podem ir para endereços que existam no site; o que vier no `contexto` existe.

**Folha de cálculo** (conector Google Sheets), id `1KWSUmCMXsHEgwEqfieKtEWYwPXPWTCQZsnes3LCDwDI`:
- `memory!A1`: número do último artigo publicado.
- `keywords-prod!A:A`: palavras-chave, uma por linha.
- `imagens-usadas`: imagens já usadas (colunas: chave, ficheiro, banco, fotógrafo, página da foto, artigo N, id no site, palavra-chave, data, notas).

**1. Palavra-chave.**
- Lê `memory!A1` (= M). O artigo de hoje é o número N = M + 1 e usa a palavra-chave da linha N de `keywords-prod`.
- Se a linha N estiver vazia, as palavras-chave acabaram: termina e diz-mo, sem escrever nada.
- Lê o `contexto/`. Se a palavra-chave já estiver em `usedKeywords`, ou o tema já estiver bem coberto por um artigo em `posts`, avança para a linha seguinte (N + 1) e explica no resumo.

**2. Pesquisa.**
- Pesquisa na web o que as pessoas procuram com esta palavra-chave em Portugal.
- Factos legais, fiscais ou técnicos (ISV, IUC, inspeções, garantias, importação, crédito, zonas de emissões) só de fontes oficiais: imt-ip.pt, portaldasfinancas.gov.pt, diariodarepublica.pt, eportugal.gov.pt, consumidor.gov.pt, clientebancario.bportugal.pt, ansr.pt, ou o site da câmara municipal.
- Na dúvida, não ponhas números, prazos ou valores. Nunca inventes estatísticas, preços, casos ou citações.
- Sobre a Zona Auto, diz só o que é verdade: stand de carros usados em Lisboa; carros revistos e com garantia (vê a garantia de cada carro no contexto, não prometas mais); financiamento; retoma; importação por encomenda; entregas em Portugal continental. Contactos por WhatsApp e telefone (o site já os mostra; não é preciso pô-los no texto).

**3. Imagem de destaque.**
- Antes de escolher, lê `imagens-usadas` e não uses nenhuma foto que lá esteja (compara a coluna "chave").
- Procura no **Pexels**: `GET https://api.pexels.com/v1/search?query=…&orientation=landscape&per_page=15`, cabeçalho `Authorization: $PEXELS_API_KEY`. Pesquisa em inglês. Usa `src.large2x`. Crédito `"Foto: {photographer} / Pexels"`, `creditUrl` = `photographer_url`. Chave na folha: `pexels:{id}`.
- Se não houver nada bom, usa o **Unsplash**: `GET https://api.unsplash.com/search/photos?query=…&orientation=landscape`, cabeçalho `Authorization: Client-ID $UNSPLASH_ACCESS_KEY`. Usa `urls.raw`, chama `links.download_location` com o mesmo cabeçalho (obrigatório pelas regras do Unsplash). Crédito `"Foto: {user.name} / Unsplash"`, `creditUrl` = `{user.links.html}?utm_source=zona_auto&utm_medium=referral`. Chave na folha: `unsplash:{id}`.
- A foto deve mostrar carros, um stand, uma estrada ou alguém a conduzir, de acordo com o tema; sem matrículas legíveis, sem logótipos de outros stands e sem texto por cima.
- `alt` em português, a descrever o que se vê (ex.: "Fila de carros usados em exposição num stand").

**4. Escrever.**
- **Título:** com a palavra-chave e diferente dos que já existem.
- **`seoTitle`:** 30 a 60 caracteres, com a palavra-chave. **`seoDescription`:** 70 a 155, com a palavra-chave e um motivo para clicar.
- **`slug`:** curto, sem acentos, com a palavra-chave.
- **`contentHtml`:** 1000 a 1500 palavras, HTML simples (`<p> <h2> <h3> <ul> <ol> <li> <strong> <em> <a> <blockquote> <table>`), sem `<h1>`, parágrafos curtos (até 120 palavras).
- **Estrutura:** introdução que responde logo à pergunta de quem pesquisa, com a palavra-chave no primeiro parágrafo; 4 a 7 secções `<h2>`, uma delas com a palavra-chave; conselhos práticos para quem compra carro em Portugal; conclusão com um convite natural a ver o stock (`/stock/`), a falar connosco (`/contactos/`) ou, se o carro não estiver em stock, a importação (`/importacao/`).
- **Ligações internas:** 3 a 6, só para endereços do `contexto` (páginas, `makes`, artigos em `posts`). No máximo 1 ligação para um carro concreto de `cars`, porque os carros saem do stock quando são vendidos; prefere `/stock/?marca=…`.
- **Ligações externas:** 1 a 2, para as fontes oficiais usadas.
- **`faq`:** 3 a 5 perguntas reais, com respostas curtas e diretas. Não as repitas no `contentHtml`.
- **`sources`:** as fontes oficiais usadas.
- **Também:** `secondaryKeywords` (2 a 5), `excerpt` (1 a 2 frases) e `tags` (2 a 4).
- **Tom:** próximo e claro, tratando o leitor por "tu", como o resto do site; português de Portugal ("viatura", "stand", "quilómetros", "IUC"; nunca "carro zero", "aluguel" ou formas do Brasil).

**5. Rever.** Lê o artigo como um revisor: corta repetições, confirma os factos com as fontes e confirma que cada ligação interna está no contexto.

**6. Enviar.**
- `POST https://zonaauto.pt/api/v1/artigos/` com `"status": "draft"` e o cabeçalho `Idempotency-Key: <slug>-<data de hoje>`.
- Se a resposta for 400, 409 ou 422, corrige e envia outra vez (no máximo 3 vezes).
- Vê os `seo.warnings` e corrige o que fizer sentido com `PATCH {id}/`.

**7. Publicar.**
- Se não houver dúvidas sobre os factos e `seo.score` for 80 ou mais, faz `PATCH {id}/` com `{ "status": "published" }`.
- Senão, deixa em rascunho e explica porquê no resumo.

**8. Atualizar a folha** (só depois de o artigo estar criado no site):
- `memory!A1` = N (mesmo que tenha ficado em rascunho, para amanhã avançar).
- Acrescenta uma linha a `imagens-usadas`: chave (`pexels:{id}` ou `unsplash:{id}`), ficheiro (nome ou id da foto no banco), banco, fotógrafo, página da foto, N, id do artigo no site, palavra-chave, data de hoje (AAAA-MM-DD) e notas (vazio, ou "rascunho" se não foi publicado).

**9. Resumo final:** número N e palavra-chave; título; estado (publicado ou rascunho, e porquê); pontuação SEO; `url`; imagem e crédito; fontes usadas; o que deva verificar à mão.

**Se algo falhar** (folha inacessível, chave em falta, site em baixo, sem imagem adequada): não inventes nem uses outra via, não mudes a folha e termina com o erro exato.
