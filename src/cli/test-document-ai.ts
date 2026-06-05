/**
 * Smoke test: Document AI Enterprise OCR (requires ADC or service account in .env).
 * Usage: node --import tsx src/cli/test-document-ai.ts [image-url]
 */
import { loadConfig } from "../config.js";
import {
  assertDocumentAiConfigured,
  documentAiUsesApplicationDefaultCredentials,
  getDocumentAiAccessToken,
} from "../services/document-ai-auth.js";
import { processCarouselSlideUrlWithDocumentAi } from "../services/document-ai-enterprise-ocr.js";

const DEFAULT_IMAGE =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/HelloWorld.svg/800px-HelloWorld.svg.png";

async function main() {
  const config = loadConfig();
  assertDocumentAiConfigured(config);

  const authMode = documentAiUsesApplicationDefaultCredentials(config) ? "application-default (gcloud)" : "service account";
  console.log(`Document AI auth: ${authMode}`);
  console.log(`Project: ${config.DOCUMENT_AI_PROJECT_ID}`);
  console.log(`Processor: ${config.DOCUMENT_AI_PROCESSOR_ID} (${config.DOCUMENT_AI_LOCATION})`);

  const token = await getDocumentAiAccessToken(config);
  console.log(`Access token OK (${token.length} chars)`);

  const imageUrl = process.argv[2]?.trim() || DEFAULT_IMAGE;
  console.log(`OCR image: ${imageUrl}`);

  const ocr = await processCarouselSlideUrlWithDocumentAi(config, imageUrl, 1);
  console.log("\n--- OCR result ---");
  console.log(JSON.stringify(ocr, null, 2));
}

main().catch((e) => {
  console.error("Document AI test failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
