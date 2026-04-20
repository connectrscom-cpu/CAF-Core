import { describe, expect, it } from "vitest";
import {
  facebookPostWebPermalink,
  graphErrorMeansPageTokenCannotListMeAccounts,
  pickPageTokenFromAccountsResponse,
  placementPlatformToMetaIntegrationKey,
  readIgUserIdFromMetaIntegrationAccountJson,
} from "./meta-graph-publish.js";

describe("readIgUserIdFromMetaIntegrationAccountJson", () => {
  it("prefers ig_user_id", () => {
    expect(
      readIgUserIdFromMetaIntegrationAccountJson({
        ig_user_id: "111",
        ig_business_account_id: "222",
      })
    ).toBe("111");
  });
  it("falls back to ig_business_account_id (CSV import alias)", () => {
    expect(readIgUserIdFromMetaIntegrationAccountJson({ ig_business_account_id: "17841400000000000" })).toBe(
      "17841400000000000"
    );
  });
  it("accepts instagram_user_id", () => {
    expect(readIgUserIdFromMetaIntegrationAccountJson({ instagram_user_id: "333" })).toBe("333");
  });
});

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

describe("facebookPostWebPermalink", () => {
  it("splits Graph compound page post id for permalink.php", () => {
    expect(facebookPostWebPermalink("673711675834588", "673711675834588_122157967562973897")).toBe(
      "https://www.facebook.com/permalink.php?story_fbid=122157967562973897&id=673711675834588"
    );
  });
  it("uses page id and full id when post id is not compound", () => {
    expect(facebookPostWebPermalink("673711675834588", "122157967562973897")).toBe(
      "https://www.facebook.com/permalink.php?story_fbid=122157967562973897&id=673711675834588"
    );
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
