/**
 * Cloud Run Document AI OCR proxy.
 * Uses Application Default Credentials from the Cloud Run service account (no JSON keys).
 *
 * POST /v1/ocr/slide
 * Authorization: Bearer <DOCUMENT_AI_PROXY_TOKEN>
 * Body: { content_base64, mime_type, slide_index }
 * Response: { document: { ... Document AI document ... } }
 */
import { createServer } from "node:http";
import { GoogleAuth } from "google-auth-library";

const PORT = Number(process.env.PORT || 8080);
const PROXY_TOKEN = process.env.DOCUMENT_AI_PROXY_TOKEN?.trim() || "";
const PROJECT_ID = process.env.DOCUMENT_AI_PROJECT_ID?.trim() || "";
const LOCATION = process.env.DOCUMENT_AI_LOCATION?.trim() || "us";
const PROCESSOR_ID = process.env.DOCUMENT_AI_PROCESSOR_ID?.trim() || "";
const PROCESSOR_VERSION = process.env.DOCUMENT_AI_PROCESSOR_VERSION?.trim() || "";
const TIMEOUT_MS = 120_000;

function processUrl() {
  const base = `https://${LOCATION}-documentai.googleapis.com/v1`;
  if (PROCESSOR_VERSION) {
    return `${base}/projects/${PROJECT_ID}/locations/${LOCATION}/processors/${PROCESSOR_ID}/processorVersions/${PROCESSOR_VERSION}:process`;
  }
  return `${base}/projects/${PROJECT_ID}/locations/${LOCATION}/processors/${PROCESSOR_ID}:process`;
}

function assertConfig() {
  const missing = [];
  if (!PROXY_TOKEN) missing.push("DOCUMENT_AI_PROXY_TOKEN");
  if (!PROJECT_ID) missing.push("DOCUMENT_AI_PROJECT_ID");
  if (!PROCESSOR_ID) missing.push("DOCUMENT_AI_PROCESSOR_ID");
  if (missing.length) {
    throw new Error(`Missing env: ${missing.join(", ")}`);
  }
}

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

async function getAccessToken() {
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("failed to obtain GCP access token");
  return token.token;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleOcrSlide(body) {
  const content = String(body?.content_base64 ?? "").trim();
  const mimeType = String(body?.mime_type ?? "image/jpeg").trim();
  if (!content) throw new Error("content_base64 is required");

  const token = await getAccessToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(processUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rawDocument: { content, mimeType },
        processOptions: { ocrConfig: { premiumFeatures: { computeStyleInfo: true } } },
      }),
      signal: controller.signal,
    });
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`Document AI failed (${res.status}): ${rawText.slice(0, 800)}`);
    }
    const parsed = JSON.parse(rawText);
    if (!parsed?.document || typeof parsed.document !== "object") {
      throw new Error("Document AI response missing document");
    }
    return parsed.document;
  } finally {
    clearTimeout(timer);
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/healthz") {
      return sendJson(res, 200, { ok: true });
    }
    if (req.method !== "POST" || req.url !== "/v1/ocr/slide") {
      return sendJson(res, 404, { ok: false, error: "not_found" });
    }

    const authHeader = req.headers.authorization || "";
    const expected = `Bearer ${PROXY_TOKEN}`;
    if (!PROXY_TOKEN || authHeader !== expected) {
      return sendJson(res, 401, { ok: false, error: "unauthorized" });
    }

    const body = await readJsonBody(req);
    const document = await handleOcrSlide(body);
    return sendJson(res, 200, { ok: true, document });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return sendJson(res, 500, { ok: false, error: message });
  }
});

assertConfig();
server.listen(PORT, () => {
  console.log(`document-ai-proxy listening on :${PORT}`);
});
