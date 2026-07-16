/**
 * Distinct text-content lanes — LinkedIn (text / document+images), Reddit, Instagram thread.
 */
import { FLOW_LINKEDIN_DOCUMENT_POST, isLinkedInDocumentPostFlow } from "./linkedin-document-post-flow-types.js";

export const FLOW_LINKEDIN_TEXT_POST = "FLOW_LINKEDIN_TEXT_POST" as const;
export const FLOW_REDDIT_POST = "FLOW_REDDIT_POST" as const;
export const FLOW_INSTAGRAM_THREAD = "FLOW_INSTAGRAM_THREAD" as const;

export { FLOW_LINKEDIN_DOCUMENT_POST, isLinkedInDocumentPostFlow };

export const TEXT_CONTENT_FLOW_TYPES = [
  FLOW_LINKEDIN_TEXT_POST,
  FLOW_LINKEDIN_DOCUMENT_POST,
  FLOW_REDDIT_POST,
  FLOW_INSTAGRAM_THREAD,
] as const;

export type TextContentFlowType = (typeof TEXT_CONTENT_FLOW_TYPES)[number];

/** Idea `format` values that map 1:1 to a text content flow. */
export const TEXT_IDEA_FORMATS = [
  "linkedin_text",
  "linkedin_document",
  "reddit_post",
  "instagram_thread",
] as const;

export type TextIdeaFormat = (typeof TEXT_IDEA_FORMATS)[number];

const FORMAT_TO_FLOW: Record<TextIdeaFormat, TextContentFlowType> = {
  linkedin_text: FLOW_LINKEDIN_TEXT_POST,
  linkedin_document: FLOW_LINKEDIN_DOCUMENT_POST,
  reddit_post: FLOW_REDDIT_POST,
  instagram_thread: FLOW_INSTAGRAM_THREAD,
};

const FORMAT_TO_PLATFORM: Record<TextIdeaFormat, string> = {
  linkedin_text: "LinkedIn",
  linkedin_document: "LinkedIn",
  reddit_post: "Reddit",
  instagram_thread: "Instagram",
};

export function isTextIdeaFormat(raw: unknown): raw is TextIdeaFormat {
  const f = String(raw ?? "")
    .trim()
    .toLowerCase();
  return (TEXT_IDEA_FORMATS as readonly string[]).includes(f);
}

export function flowTypeForTextIdeaFormat(raw: unknown): TextContentFlowType | null {
  const f = String(raw ?? "")
    .trim()
    .toLowerCase();
  return FORMAT_TO_FLOW[f as TextIdeaFormat] ?? null;
}

export function defaultPlatformForTextIdeaFormat(raw: unknown): string | null {
  const f = String(raw ?? "")
    .trim()
    .toLowerCase();
  return FORMAT_TO_PLATFORM[f as TextIdeaFormat] ?? null;
}

export function isLinkedInTextPostFlow(flowType: string | null | undefined): boolean {
  return String(flowType ?? "").trim() === FLOW_LINKEDIN_TEXT_POST;
}

export function isRedditPostFlow(flowType: string | null | undefined): boolean {
  return String(flowType ?? "").trim() === FLOW_REDDIT_POST;
}

export function isInstagramThreadFlow(flowType: string | null | undefined): boolean {
  return String(flowType ?? "").trim() === FLOW_INSTAGRAM_THREAD;
}

export function isTextContentFlow(flowType: string | null | undefined): boolean {
  const ft = String(flowType ?? "").trim();
  return (
    isLinkedInTextPostFlow(ft) ||
    isLinkedInDocumentPostFlow(ft) ||
    isRedditPostFlow(ft) ||
    isInstagramThreadFlow(ft)
  );
}

/** Text flows that skip render (copy-only → IN_REVIEW). */
export function isPlainTextContentFlow(flowType: string | null | undefined): boolean {
  return (
    isLinkedInTextPostFlow(flowType) || isRedditPostFlow(flowType) || isInstagramThreadFlow(flowType)
  );
}
