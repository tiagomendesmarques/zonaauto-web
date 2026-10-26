#!/usr/bin/env bash
# Instala (ou atualiza) o site no Google Cloud. Pode ser corrido várias vezes sem problema.
#
#   PROJECT_ID=o-meu-projeto ./deploy.sh
#
# O que faz:
#   1. Ativa os serviços necessários e cria um bucket para guardar o último inventário.
#   2. Publica o site no Cloud Run (a imagem é construída pelo Cloud Build a partir do Dockerfile).
#   3. Cria a tarefa do Cloud Scheduler que sincroniza o stock com o Standvirtual a cada 30 minutos.
#   4. Liga o repositório do GitHub ao projeto (sem chaves), para que cada push para main
#      publique o site automaticamente (.github/workflows/deploy.yml).
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Defina PROJECT_ID, ex.: PROJECT_ID=zonaauto ./deploy.sh}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-zonaauto}"
BUCKET="${BUCKET:-${PROJECT_ID}-zonaauto-data}"
GITHUB_REPO="${GITHUB_REPO:-tiagomendesmarques/zonaauto-web}"
SYNC_TOKEN="${SYNC_TOKEN:-$(openssl rand -hex 24)}"

RUNTIME_SA="zonaauto-site@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="zonaauto-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
POOL="github"
PROVIDER="github-oidc"

step() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
quiet() { "$@" >/dev/null; }

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

step "A ativar serviços"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com cloudscheduler.googleapis.com \
  artifactregistry.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

step "Conta de serviço do site e bucket do inventário"
gcloud iam service-accounts describe "$RUNTIME_SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create zonaauto-site --display-name "Site Zona Auto"
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access
quiet gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$RUNTIME_SA" --role="roles/storage.objectAdmin"
# O Cloud Build usa a conta de serviço predefinida do Compute para construir a imagem
quiet gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$COMPUTE_SA" --role="roles/run.builder" --condition=None

step "A publicar no Cloud Run"
ENV_FILE=$(mktemp)
trap 'rm -f "$ENV_FILE"' EXIT
[ -f env.yaml ] && cat env.yaml > "$ENV_FILE"
printf '\nSNAPSHOT_BUCKET: "%s"\nSYNC_TOKEN: "%s"\n' "$BUCKET" "$SYNC_TOKEN" >> "$ENV_FILE"
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --service-account "$RUNTIME_SA" \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --env-vars-file "$ENV_FILE" \
  --quiet
URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')

step "Sincronização automática do stock (a cada 30 minutos)"
JOB="${SERVICE}-sync"
ACTION=create; HEADERS_FLAG=--headers
if gcloud scheduler jobs describe "$JOB" --location "$REGION" >/dev/null 2>&1; then ACTION=update; HEADERS_FLAG=--update-headers; fi
gcloud scheduler jobs "$ACTION" http "$JOB" \
  --location "$REGION" \
  --schedule "*/30 * * * *" \
  --time-zone "Europe/Lisbon" \
  --uri "$URL/tarefas/sincronizar" \
  --http-method POST \
  "$HEADERS_FLAG" "x-sync-token=$SYNC_TOKEN" \
  --attempt-deadline 300s
curl -fsS -X POST -H "x-sync-token: $SYNC_TOKEN" "$URL/tarefas/sincronizar" && echo

step "Publicação automática a partir do GitHub ($GITHUB_REPO)"
gcloud iam service-accounts describe "$DEPLOY_SA" >/dev/null 2>&1 || \
  gcloud iam service-accounts create zonaauto-deployer --display-name "Deploy do site a partir do GitHub"
for ROLE in roles/run.admin roles/cloudbuild.builds.editor roles/artifactregistry.writer \
            roles/storage.admin roles/serviceusage.serviceUsageConsumer roles/logging.viewer; do
  quiet gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEPLOY_SA" --role="$ROLE" --condition=None
done
for SA in "$RUNTIME_SA" "$COMPUTE_SA"; do
  quiet gcloud iam service-accounts add-iam-policy-binding "$SA" \
    --member="serviceAccount:$DEPLOY_SA" --role="roles/iam.serviceAccountUser"
done
gcloud iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub"
gcloud iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL" --display-name="GitHub Actions" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}'"
quiet gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_REPO}"
WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"

VARS=(GCP_PROJECT_ID="$PROJECT_ID" GCP_REGION="$REGION" GCP_SERVICE="$SERVICE" GCP_WIF_PROVIDER="$WIF_PROVIDER" GCP_DEPLOY_SA="$DEPLOY_SA")
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  for KV in "${VARS[@]}"; do gh variable set "${KV%%=*}" --body "${KV#*=}" --repo "$GITHUB_REPO"; done
  echo "Variáveis do GitHub definidas."
else
  echo "Cria estas variáveis em https://github.com/${GITHUB_REPO}/settings/variables/actions :"
  for KV in "${VARS[@]}"; do echo "  ${KV%%=*} = ${KV#*=}"; done
fi

step "Concluído"
echo "Site: $URL"
echo "Estado do stock: $URL/estado"
echo "Para usar zonaauto.pt: Cloud Run > $SERVICE > Domínios personalizados (ou: gcloud beta run domain-mappings create --service $SERVICE --domain zonaauto.pt --region $REGION)"
