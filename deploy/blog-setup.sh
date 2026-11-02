#!/usr/bin/env bash
# Prepara o blog no Google Cloud (uma vez). Pode ser corrido de novo sem problema.
#
#   PROJECT_ID=o-meu-projeto ./deploy/blog-setup.sh
#
# O que faz:
#   1. Cria a base de dados Firestore (artigos, redirects, auditoria) e dá acesso ao site.
#   2. Gera a chave da API de artigos (64 caracteres) no Secret Manager e passa-a ao site como BLOG_API_TOKEN.
#   3. Cria a tarefa diária que apaga as imagens do blog que já nenhum artigo usa.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Defina PROJECT_ID, ex.: PROJECT_ID=zonaauto ./deploy/blog-setup.sh}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-zonaauto}"
SECRET="${SECRET:-zonaauto-blog-api-token}"
RUNTIME_SA="zonaauto-site@${PROJECT_ID}.iam.gserviceaccount.com"

step() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
quiet() { "$@" >/dev/null; }

gcloud config set project "$PROJECT_ID" >/dev/null

step "A ativar o Firestore e o Secret Manager"
gcloud services enable firestore.googleapis.com secretmanager.googleapis.com

step "Base de dados Firestore"
gcloud firestore databases describe --database="(default)" >/dev/null 2>&1 || \
  gcloud firestore databases create --database="(default)" --location="$REGION" --type=firestore-native
quiet gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$RUNTIME_SA" --role="roles/datastore.user" --condition=None
# Os contadores do limite de pedidos apagam-se sozinhos
gcloud firestore fields ttls update expireAt --collection-group=rate_limits --enable-ttl --quiet >/dev/null 2>&1 || true

step "Chave da API de artigos"
if ! gcloud secrets describe "$SECRET" >/dev/null 2>&1; then
  openssl rand -base64 64 | tr -dc 'A-Za-z0-9' | head -c 64 | gcloud secrets create "$SECRET" --replication-policy=automatic --data-file=-
fi
quiet gcloud secrets add-iam-policy-binding "$SECRET" \
  --member="serviceAccount:$RUNTIME_SA" --role="roles/secretmanager.secretAccessor"
gcloud run services update "$SERVICE" --region "$REGION" --update-secrets "BLOG_API_TOKEN=${SECRET}:latest" --quiet

step "Limpeza diária de imagens do blog"
URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')
SYNC_TOKEN=$(gcloud run services describe "$SERVICE" --region "$REGION" --format=json \
  | python3 -c "import json,sys; e=json.load(sys.stdin)['spec']['template']['spec']['containers'][0].get('env',[]); print(next((x['value'] for x in e if x['name']=='SYNC_TOKEN'),''))")
JOB="${SERVICE}-limpar-imagens"
ACTION=create; HEADERS_FLAG=--headers
if gcloud scheduler jobs describe "$JOB" --location "$REGION" >/dev/null 2>&1; then ACTION=update; HEADERS_FLAG=--update-headers; fi
gcloud scheduler jobs "$ACTION" http "$JOB" \
  --location "$REGION" \
  --schedule "17 4 * * *" \
  --time-zone "Europe/Lisbon" \
  --uri "$URL/tarefas/limpar-imagens" \
  --http-method POST \
  "$HEADERS_FLAG" "x-sync-token=$SYNC_TOKEN" \
  --attempt-deadline 300s

step "A confirmar"
code=$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/v1/artigos/contexto/")
echo "Pedido sem chave: $code (tem de ser 401)"
echo
echo "Blog pronto. A chave da API está no Secret Manager ($SECRET). Para a ver:"
echo "  gcloud secrets versions access latest --secret=$SECRET"
