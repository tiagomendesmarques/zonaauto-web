# Zona Auto — site com inventário automático do Standvirtual

O stand só tem de publicar as viaturas no Standvirtual. Este site lê o inventário de
`https://zonaautopt.standvirtual.com/inventory` sozinho e mostra todas as viaturas
(fotos, preço, características, equipamento e descrição). As viaturas vendidas ou
retiradas do Standvirtual desaparecem do site na sincronização seguinte.

## Como funciona

```
Standvirtual ──(a cada 30 min)──▶ Cloud Run (Node.js) ──▶ zonaauto.pt
                                     │
                                     └── último inventário guardado em Cloud Storage
```

- **Um único serviço** Node.js/Express em Cloud Run. Sem base de dados e sem WordPress.
- A leitura usa a página de inventário do stand (preço, fotos, características) e a página de cada
  anúncio (descrição, todas as fotos, equipamento). Se a página de um anúncio falhar, a viatura
  aparece na mesma com os dados do inventário.
- **Cloud Scheduler** chama `/tarefas/sincronizar` a cada 30 minutos.
- O inventário fica em memória e é guardado num bucket do Cloud Storage. Assim o site
  arranca de imediato e continua a mostrar as viaturas se o Standvirtual estiver em baixo.
- Se uma sincronização trouxer de repente muito menos viaturas (possível erro de leitura),
  o site mantém o inventário anterior até a sincronização seguinte confirmar o número.
- Custo estimado: praticamente zero (fica dentro do nível gratuito do Cloud Run com este tráfego).

## Páginas

| URL | Conteúdo |
|---|---|
| `/` | Destaque, pesquisa rápida, stock, como funciona, serviços, importação, perguntas frequentes |
| `/stock/` | Todas as viaturas, com filtros (marca, modelo, combustível, caixa, segmento, preço, ano, km) e ordenação |
| `/stock/<marca-modelo-ano-ref>/` | Galeria, preço, características agrupadas, equipamento, descrição, WhatsApp e telefone |
| `/importacao/`, `/contactos/` | Formulários que abrem o WhatsApp do stand com o pedido já escrito |
| `/politica-de-privacidade/`, `/termos-e-condicoes-de-utilizacao/` | Textos legais do site anterior |
| `/foto/<id>/<tamanho>.jpg` | Fotos do Standvirtual servidas pelo próprio site, com cache |
| `/sitemap.xml`, `/robots.txt` | SEO (cada viatura tem também dados estruturados schema.org) |
| `/estado` | Estado: nº de viaturas, última sincronização, último erro |
| `/api/viaturas` | Inventário em JSON |

Os endereços antigos do WordPress (`/listings/...`) redirecionam para a viatura correspondente ou para o stock.

## Correr localmente

```bash
npm install
npm run sync     # testa a leitura do Standvirtual e grava data/inventory.json
# (atrás de um proxy HTTP, prefixar com NODE_USE_ENV_PROXY=1)
npm start        # http://localhost:8080
```

## Publicar no Google Cloud (uma só vez)

O mais simples é usar o **Cloud Shell** (https://shell.cloud.google.com), que já tem o `gcloud`:

```bash
gh auth login                      # para clonar o repositório privado e criar as variáveis do GitHub
gh repo clone tiagomendesmarques/zonaauto-web && cd zonaauto-web
PROJECT_ID=o-meu-projeto ./deploy.sh
```

O `deploy.sh` cria tudo: Cloud Run, bucket do inventário, a sincronização a cada 30 minutos e a
ligação do GitHub ao projeto (Workload Identity, sem chaves guardadas no GitHub). Pode ser
corrido de novo sem problema. No fim mostra o endereço do site.

Para usar o domínio: Cloud Run → `zonaauto` → *Domínios personalizados* → `zonaauto.pt`, e
copiar os registos DNS indicados para o fornecedor do domínio.

## Atualizações

| O quê | Como acontece |
|---|---|
| Carros (novos, vendidos, preços, fotos) | Automático. O Cloud Scheduler sincroniza com o Standvirtual a cada 30 minutos. |
| Código, textos ou design | Automático. Cada `git push` para `main` publica uma nova versão (GitHub Actions → Cloud Run). |
| Telefone, horário, morada | Editar `env.yaml` e correr `./deploy.sh`, ou mudar as variáveis no Cloud Run. |

Se uma publicação falhar, o Cloud Run continua a servir a versão anterior. Para voltar atrás:
Cloud Run → `zonaauto` → *Revisões* → enviar o tráfego para a revisão anterior.

## Medição (Google Tag Manager / Meta)

O site carrega o GTM `GTM-NNQ8RX77` (variável `GTM_ID`) e envia para o `dataLayer`:

| Evento | Quando | Parâmetros |
|---|---|---|
| `whatsapp_click` | Qualquer botão de WhatsApp, incluindo os formulários | `contacto_local`, e na página de uma viatura `viatura`, `valor`, `moeda` |
| `telefone_click` | Clique num número de telefone | os mesmos |

`contacto_local`: `botao_flutuante`, `rodape`, `viatura_informacoes`, `viatura_agendar_visita`,
`viatura_marcar_visita`, `formulario_contactos`, `formulario_importacao`, `stock_vazio`, `cabecalho`, `pagina`.

## Personalizar

- Cores e fontes: variáveis no topo de `public/css/style.css`.
- Imagens e logótipo: `public/img/`.
- Dados do stand: `env.yaml` (ver `env.example.yaml`).
- Textos: `views/*.ejs`.
- Leitura do Standvirtual: `src/scraper.js`.
