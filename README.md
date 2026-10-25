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
- **Cloud Scheduler** chama `/tarefas/sincronizar` a cada 30 minutos.
- O inventário fica em memória e é guardado num bucket do Cloud Storage. Assim o site
  arranca de imediato e continua a mostrar as viaturas se o Standvirtual estiver em baixo.
- Se uma sincronização trouxer de repente muito menos viaturas (possível erro de leitura),
  o site mantém o inventário anterior até a sincronização seguinte confirmar o número.
- Custo estimado: praticamente zero (fica dentro do nível gratuito do Cloud Run com este tráfego).

## Páginas

| URL | Conteúdo |
|---|---|
| `/` | Destaque, pesquisa rápida, últimas entradas, vantagens |
| `/viaturas` | Todas as viaturas, com filtros (marca, modelo, combustível, caixa, preço, ano, km) e ordenação |
| `/viaturas/<marca-modelo-id>` | Galeria, preço, destaques, descrição, características, equipamento, WhatsApp/telefone/email |
| `/sobre`, `/contactos` | Páginas institucionais com mapa |
| `/sitemap.xml`, `/robots.txt` | SEO (cada viatura tem também dados estruturados schema.org) |
| `/healthz` | Estado: nº de viaturas, última sincronização, último erro |
| `/api/viaturas` | Inventário em JSON |

## Correr localmente

```bash
npm install
npm run sync     # testa a leitura do Standvirtual e grava data/inventory.json
npm start        # http://localhost:8080
```

## Publicar no Google Cloud

1. Instalar o [gcloud](https://cloud.google.com/sdk/docs/install) e fazer `gcloud auth login`.
2. `cp env.example.yaml env.yaml` e preencher telefone, WhatsApp, email, morada, horário.
3. `PROJECT_ID=o-seu-projeto ./deploy.sh`
4. Associar o domínio: Cloud Run → *Manage custom domains* → `zonaauto.pt`, e atualizar
   o DNS conforme indicado.

## Personalizar

- Cores: variáveis no topo de `public/css/style.css` (`--brand`, etc.).
- Logótipo: `public/img/logo.svg` e `public/img/logo-white.svg`.
- Textos: `views/*.ejs`.
- Leitura do Standvirtual: `src/scraper.js`.
