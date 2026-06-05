import { existsSync, readFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";
import type { AppConfig } from "../config.js";

const DOCUMENT_AI_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

let cachedAuth: GoogleAuth | null = null;
let cachedAuthMode: "inline" | "file" | "adc" | null = null;

export function documentAiEnabled(config: AppConfig): boolean {
  if (!config.DOCUMENT_AI_ENABLED) return false;
  return Boolean(config.DOCUMENT_AI_PROJECT_ID?.trim() && config.DOCUMENT_AI_PROCESSOR_ID?.trim());
}

export function resolveDocumentAiCredentialMode(config: AppConfig): "inline" | "file" | "adc" {
  const inline = config.DOCUMENT_AI_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) return "inline";
  const path = config.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (path && existsSync(path)) return "file";
  return "adc";
}

export function documentAiUsesApplicationDefaultCredentials(config: AppConfig): boolean {
  return resolveDocumentAiCredentialMode(config) === "adc";
}

export function documentAiAuthModeLabel(config: AppConfig): string {
  const mode = resolveDocumentAiCredentialMode(config);
  if (mode === "inline") return "service account (DOCUMENT_AI_SERVICE_ACCOUNT_JSON)";
  if (mode === "file") return `service account file (${config.GOOGLE_APPLICATION_CREDENTIALS?.trim()})`;
  return "ADC (gcloud application-default login)";
}

export function assertDocumentAiConfigured(config: AppConfig): void {
  if (!documentAiEnabled(config)) {
    throw new Error(
      "Document AI Enterprise OCR is not configured. Set DOCUMENT_AI_ENABLED=1, DOCUMENT_AI_PROJECT_ID, " +
        "and DOCUMENT_AI_PROCESSOR_ID. Auth: GOOGLE_APPLICATION_CREDENTIALS, DOCUMENT_AI_SERVICE_ACCOUNT_JSON, " +
        "or run `gcloud auth application-default login` (Application Default Credentials)."
    );
  }
}

export function resolveDocumentAiCredentials(config: AppConfig): Record<string, unknown> | null {
  const mode = resolveDocumentAiCredentialMode(config);
  if (mode === "inline") {
    try {
      return JSON.parse(config.DOCUMENT_AI_SERVICE_ACCOUNT_JSON!.trim()) as Record<string, unknown>;
    } catch {
      throw new Error("DOCUMENT_AI_SERVICE_ACCOUNT_JSON is not valid JSON");
    }
  }
  if (mode === "file") {
    const path = config.GOOGLE_APPLICATION_CREDENTIALS!.trim();
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch (e) {
      throw new Error(
        `Failed to read GOOGLE_APPLICATION_CREDENTIALS at ${path}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
  return null;
}

/** Fly/production cannot use gcloud ADC — require inline JSON or a credentials file. */
export function assertDocumentAiRuntimeAuth(config: AppConfig): void {
  assertDocumentAiConfigured(config);
  const mode = resolveDocumentAiCredentialMode(config);
  if (config.NODE_ENV === "production" && mode === "adc") {
    throw new Error(
      "Document AI on Fly/production requires DOCUMENT_AI_SERVICE_ACCOUNT_JSON (GCP service account key JSON). " +
        "ADC from `gcloud auth application-default login` works locally only. " +
        "Create a key in GCP Console → IAM → Service Accounts → Keys, then: " +
        "fly secrets set DOCUMENT_AI_SERVICE_ACCOUNT_JSON='{\"type\":\"service_account\",...}' -a caf-core"
    );
  }
}

function googleAuthForConfig(config: AppConfig): GoogleAuth {
  const mode = resolveDocumentAiCredentialMode(config);
  if (!cachedAuth || cachedAuthMode !== mode) {
    const credentials = mode === "inline" || mode === "file" ? resolveDocumentAiCredentials(config) : null;
    cachedAuth = credentials
      ? new GoogleAuth({ credentials, scopes: [DOCUMENT_AI_SCOPE] })
      : new GoogleAuth({ scopes: [DOCUMENT_AI_SCOPE] });
    cachedAuthMode = mode;
  }
  return cachedAuth;
}

export async function getDocumentAiAccessToken(config: AppConfig): Promise<string> {
  const auth = googleAuthForConfig(config);
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const access = token.token;
  if (!access) throw new Error("Document AI: failed to obtain access token");
  return access;
}

export function documentAiProcessUrl(config: AppConfig): string {
  const projectId = config.DOCUMENT_AI_PROJECT_ID!.trim();
  const location = config.DOCUMENT_AI_LOCATION.trim();
  const processorId = config.DOCUMENT_AI_PROCESSOR_ID!.trim();
  const base = `https://${location}-documentai.googleapis.com/v1`;
  const version = config.DOCUMENT_AI_PROCESSOR_VERSION?.trim();
  if (version) {
    return `${base}/projects/${projectId}/locations/${location}/processors/${processorId}/processorVersions/${version}:process`;
  }
  return `${base}/projects/${projectId}/locations/${location}/processors/${processorId}:process`;
}
