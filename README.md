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
| `/importacao/`, `/contactos/` | Formulários (enviados por email via SMTP, ou por WhatsApp se o email não estiver configurado) |
| `/politica-de-privacidade/`, `/termos-e-condicoes-de-utilizacao/` | Textos legais do site anterior |
| `/foto/<id>/<tamanho>.jpg` | Fotos do Standvirtual servidas pelo próprio site, com cache |
| `/sitemap.xml`, `/robots.txt` | SEO (cada viatura tem também dados estruturados schema.org) |

Os endereços antigos do WordPress (`/listings/...`) redirecionam para a viatura correspondente ou para o stock.
| `/healthz` | Estado: nº de viaturas, última sincronização, último erro |
| `/api/viaturas` | Inventário em JSON |

## Correr localmente

```bash
npm install
npm run sync     # testa a leitura do Standvirtual e grava data/inventory.json
# (atrás de um proxy HTTP, prefixar com NODE_USE_ENV_PROXY=1)
npm start        # http://localhost:8080
```

## Publicar no Google Cloud

1. Instalar o [gcloud](https://cloud.google.com/sdk/docs/install) e fazer `gcloud auth login`.
2. `cp env.example.yaml env.yaml` e preencher telefone, WhatsApp, email, morada, horário.
3. `PROJECT_ID=o-seu-projeto ./deploy.sh`
4. Associar o domínio: Cloud Run → *Manage custom domains* → `zonaauto.pt`, e atualizar
   o DNS conforme indicado.

## Personalizar

- Cores e fontes: variáveis no topo de `public/css/style.css`.
- Imagens e logótipo: `public/img/`.
- Dados do stand e email: `env.yaml` (ver `env.example.yaml`).
- Textos: `views/*.ejs`.
- Leitura do Standvirtual: `src/scraper.js`.
