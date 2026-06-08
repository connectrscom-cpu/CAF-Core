import { describe, expect, it } from "vitest";
import {
  assertDocumentAiRuntimeAuth,
  documentAiAuthModeLabel,
  findNonLatin1HeaderChar,
  normalizeDocumentAiProxyToken,
  resolveDocumentAiCredentialMode,
} from "./document-ai-auth.js";
import type { AppConfig } from "../config.js";

const base: AppConfig = {
  NODE_ENV: "production",
  DOCUMENT_AI_ENABLED: true,
  DOCUMENT_AI_PROJECT_ID: "caf-core",
  DOCUMENT_AI_PROCESSOR_ID: "abc123",
  DOCUMENT_AI_LOCATION: "us",
} as AppConfig;

describe("document-ai-auth", () => {
  it("requires service account JSON in production when ADC would be used", () => {
    expect(() => assertDocumentAiRuntimeAuth(base)).toThrow(/DOCUMENT_AI_SERVICE_ACCOUNT_JSON/);
  });

  it("allows inline service account JSON in production", () => {
    const config = {
      ...base,
      DOCUMENT_AI_SERVICE_ACCOUNT_JSON: '{"type":"service_account","project_id":"caf-core"}',
    } as AppConfig;
    expect(() => assertDocumentAiRuntimeAuth(config)).not.toThrow();
    expect(resolveDocumentAiCredentialMode(config)).toBe("inline");
  });

  it("detects em dash in proxy token (ByteString fetch failure)", () => {
    const token = "a".repeat(35) + "\u2014" + "b";
    expect(findNonLatin1HeaderChar(token)?.codePoint).toBe(0x2014);
    expect(findNonLatin1HeaderChar(token)?.index).toBe(35);
    expect(normalizeDocumentAiProxyToken(token)).toBe("a".repeat(35) + "b");
  });

  it("allows Cloud Run proxy in production without service account JSON", () => {
    const config = {
      ...base,
      DOCUMENT_AI_PROXY_URL: "https://caf-document-ai-proxy.example.run.app",
      DOCUMENT_AI_PROXY_TOKEN: "secret",
    } as AppConfig;
    expect(() => assertDocumentAiRuntimeAuth(config)).not.toThrow();
    expect(documentAiAuthModeLabel(config)).toMatch(/Cloud Run proxy/);
  });
});
