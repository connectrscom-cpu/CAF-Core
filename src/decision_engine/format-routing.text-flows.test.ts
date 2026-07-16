import { describe, expect, it } from "vitest";
import { bucketForFlowType, bucketForIdeaFormat, planningLaneForFlowType } from "./format-routing.js";
import {
  FLOW_INSTAGRAM_THREAD,
  FLOW_LINKEDIN_TEXT_POST,
  FLOW_REDDIT_POST,
} from "../domain/text-content-flow-types.js";
import { FLOW_LINKEDIN_DOCUMENT_POST } from "../domain/linkedin-document-post-flow-types.js";

describe("format-routing text flows", () => {
  it("maps text idea formats to post/thread buckets", () => {
    expect(bucketForIdeaFormat("linkedin_text")).toBe("post");
    expect(bucketForIdeaFormat("linkedin_document")).toBe("post");
    expect(bucketForIdeaFormat("reddit_post")).toBe("post");
    expect(bucketForIdeaFormat("instagram_thread")).toBe("thread");
  });

  it("assigns dedicated planning lanes per text flow", () => {
    expect(planningLaneForFlowType(FLOW_LINKEDIN_TEXT_POST)).toBe("linkedin_text_post");
    expect(planningLaneForFlowType(FLOW_LINKEDIN_DOCUMENT_POST)).toBe("linkedin_document_post");
    expect(planningLaneForFlowType(FLOW_REDDIT_POST)).toBe("reddit_post");
    expect(planningLaneForFlowType(FLOW_INSTAGRAM_THREAD)).toBe("instagram_thread");
  });

  it("maps flow types to format buckets", () => {
    expect(bucketForFlowType(FLOW_LINKEDIN_TEXT_POST)).toBe("post");
    expect(bucketForFlowType(FLOW_REDDIT_POST)).toBe("post");
    expect(bucketForFlowType(FLOW_INSTAGRAM_THREAD)).toBe("thread");
  });
});
