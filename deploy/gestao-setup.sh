#!/usr/bin/env bash
# Liga a área de gestão (/gestao/) no Cloud Run. Pode ser corrido de novo para mudar os emails.
#
#   PROJECT_ID=o-meu-projeto GOOGLE_CLIENT_ID=123-abc.apps.googleusercontent.com \
#     ADMIN_EMAILS=eu@gmail.com ./deploy/gestao-setup.sh
#
# Antes, criar o cliente OAuth no GCP (APIs e serviços → Credenciais → Criar credenciais →
# ID do cliente OAuth → Aplicação Web), com:
#   Origens JavaScript autorizadas:  https://zonaauto.pt
#   URIs de redirecionamento:        https://zonaauto.pt/gestao/entrar
# ADMIN_EMAILS aceita vários emails separados por vírgulas.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Defina PROJECT_ID}"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:?Defina GOOGLE_CLIENT_ID (ID do cliente OAuth)}"
ADMIN_EMAILS="${ADMIN_EMAILS:?Defina ADMIN_EMAILS (emails com acesso, separados por vírgulas)}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-zonaauto}"

# "^|^" muda o separador para "|", para os emails poderem ter vírgulas entre eles
gcloud run services update "$SERVICE" --project "$PROJECT_ID" --region "$REGION" \
  --update-env-vars "^|^GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}|ADMIN_EMAILS=${ADMIN_EMAILS}" --quiet
echo "Pronto. Entra em https://zonaauto.pt/gestao/"
