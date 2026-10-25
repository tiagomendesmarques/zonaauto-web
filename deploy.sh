#!/usr/bin/env bash
# Publica o site no Google Cloud Run e agenda a sincronização automática do inventário.
# Uso: PROJECT_ID=o-meu-projeto ./deploy.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Defina PROJECT_ID}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-zonaauto}"
BUCKET="${BUCKET:-${PROJECT_ID}-zonaauto-data}"
SYNC_TOKEN="${SYNC_TOKEN:-$(openssl rand -hex 24)}"

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com cloudscheduler.googleapis.com artifactregistry.googleapis.com

# Bucket onde fica guardado o último inventário (arranques instantâneos)
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$RUN_SA" --role="roles/storage.objectAdmin" >/dev/null

# Build + deploy (o Cloud Build constrói a imagem a partir do Dockerfile)
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --memory 512Mi \
  --min-instances 0 \
  --max-instances 3 \
  --env-vars-file env.yaml \
  --update-env-vars "SNAPSHOT_BUCKET=$BUCKET,SYNC_TOKEN=$SYNC_TOKEN"

URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')

# Sincroniza o inventário com o Standvirtual a cada 30 minutos
JOB="${SERVICE}-sync"
if gcloud scheduler jobs describe "$JOB" --location "$REGION" >/dev/null 2>&1; then
  ACTION=update
else
  ACTION=create
fi
gcloud scheduler jobs "$ACTION" http "$JOB" \
  --location "$REGION" \
  --schedule "*/30 * * * *" \
  --time-zone "Europe/Lisbon" \
  --uri "$URL/tarefas/sincronizar" \
  --http-method POST \
  --headers "x-sync-token=$SYNC_TOKEN" \
  --attempt-deadline 300s

# Primeira sincronização imediata
curl -fsS -X POST -H "x-sync-token: $SYNC_TOKEN" "$URL/tarefas/sincronizar" && echo
echo "Site publicado em: $URL"
