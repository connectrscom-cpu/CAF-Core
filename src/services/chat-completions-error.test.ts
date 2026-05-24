import { describe, expect, it } from "vitest";
import {
  chatCompletionsApiLabel,
  formatChatCompletionsHttpError,
  isChatCompletionsHttpError,
} from "./chat-completions-error.js";

describe("chat-completions-error", () => {
  it("labels NVIDIA NIM for processing Nemotron", () => {
    expect(chatCompletionsApiLabel("nvidia")).toBe("NVIDIA NIM API");
    expect(formatChatCompletionsHttpError(500, '{"error":{}}', "nvidia")).toMatch(
      /^NVIDIA NIM API error 500:/
    );
  });

  it("labels OpenAI by default", () => {
    expect(chatCompletionsApiLabel()).toBe("OpenAI API");
    expect(formatChatCompletionsHttpError(429, "rate limit")).toBe("OpenAI API error 429: rate limit");
  });

  it("detects formatted HTTP errors for audit dedupe", () => {
    const err = new Error(formatChatCompletionsHttpError(500, "Internal Server Error", "nvidia"));
    expect(isChatCompletionsHttpError(err)).toBe(true);
    expect(isChatCompletionsHttpError(new Error("network failed"))).toBe(false);
  });
});
