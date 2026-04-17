import { describe, expect, it } from "vitest";
import {
  graphErrorMeansPageTokenCannotListMeAccounts,
  pickPageTokenFromAccountsResponse,
  placementPlatformToMetaIntegrationKey,
} from "./meta-graph-publish.js";

describe("placementPlatformToMetaIntegrationKey", () => {
  it("maps Review labels", () => {
    expect(placementPlatformToMetaIntegrationKey("Facebook")).toBe("META_FB");
    expect(placementPlatformToMetaIntegrationKey("Instagram")).toBe("META_IG");
  });
  it("returns null for unknown", () => {
    expect(placementPlatformToMetaIntegrationKey("TikTok")).toBeNull();
  });
});

describe("graphErrorMeansPageTokenCannotListMeAccounts", () => {
  it("detects Meta (#100) nonexisting field (accounts) (Page token used on me/accounts)", () => {
    expect(
      graphErrorMeansPageTokenCannotListMeAccounts(
        "(#100) Tried accessing nonexisting field (accounts) on node type (Page)"
      )
    ).toBe(true);
  });
  it("detects when only message body omits (#…) but code would be prefixed by graphGet", () => {
    expect(graphErrorMeansPageTokenCannotListMeAccounts("Tried accessing nonexisting field (accounts)")).toBe(true);
  });
});

describe("pickPageTokenFromAccountsResponse", () => {
  it("returns token for matching page id", () => {
    const t = pickPageTokenFromAccountsResponse(
      {
        data: [
          { id: "111", access_token: "wrong" },
          { id: "673711675834588", access_token: "PAGE_TOKEN_OK" },
        ],
      },
      "673711675834588"
    );
    expect(t).toBe("PAGE_TOKEN_OK");
  });
  it("returns undefined when id missing", () => {
    expect(pickPageTokenFromAccountsResponse({ data: [{ id: "1", access_token: "x" }] }, "999")).toBeUndefined();
  });
});
