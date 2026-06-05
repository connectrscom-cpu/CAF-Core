# Document AI OCR proxy (Cloud Run)

Use this when your GCP organization blocks service account key creation (`iam.disableServiceAccountKeyCreation`).

Cloud Run attaches a service account at runtime — **no JSON key file** is needed.

## Deploy

**Branch:** CAF-Core uses `master` (not `main`). In Cloud Build trigger, set branch pattern to `^master$`.

### Cloud Console (continuous deploy from GitHub)

1. Cloud Run → service → **Edit & deploy new revision** → **Continuous deployment** tab, or fix trigger in **Cloud Build → Triggers**.
2. Repository: `connectrscom-cpu/CAF-Core`, branch: **`master`**
3. **Source / build directory:** `services/document-ai-proxy`
4. **Dockerfile:** `services/document-ai-proxy/Dockerfile` (if asked)
5. Service account: `document-ai-ocr@caf-core...`, allow unauthenticated
6. Env vars below

If you see the [placeholder unicorn page](https://cafcoredocai-521585232450.europe-west1.run.app), the trigger never built — fix branch to `master`, then **Run trigger** manually in Cloud Build.

```bash
# Pick a strong random token (same value goes on Fly as DOCUMENT_AI_PROXY_TOKEN)
export PROXY_TOKEN="$(openssl rand -hex 32)"

gcloud run deploy caf-document-ai-proxy \
  --source services/document-ai-proxy \
  --region us-central1 \
  --project caf-core \
  --service-account document-ai-ocr@caf-core.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --set-env-vars "DOCUMENT_AI_PROXY_TOKEN=${PROXY_TOKEN},DOCUMENT_AI_PROJECT_ID=caf-core,DOCUMENT_AI_LOCATION=us,DOCUMENT_AI_PROCESSOR_ID=YOUR_PROCESSOR_ID,DOCUMENT_AI_PROCESSOR_VERSION=pretrained-ocr-v2.1-2024-08-07"
```

Grant the service account **Document AI API User** on project `caf-core`.

Copy the deployed URL (e.g. `https://caf-document-ai-proxy-xxx.run.app`).

## Fly secrets (CAF Core)

```powershell
fly secrets set `
  DOCUMENT_AI_PROXY_URL="https://caf-document-ai-proxy-xxx.run.app" `
  DOCUMENT_AI_PROXY_TOKEN="YOUR_PROXY_TOKEN" `
  -a caf-core
```

Keep existing `DOCUMENT_AI_ENABLED=1`, `DOCUMENT_AI_PROJECT_ID`, etc. on Fly (used for config validation).

## Security

The proxy uses a shared bearer token because Fly cannot mint GCP tokens without keys. Use a long random `DOCUMENT_AI_PROXY_TOKEN`. For stricter setups, switch Cloud Run to `--no-allow-unauthenticated` and add IAM invoker for a dedicated identity (requires extra federation setup from Fly).
