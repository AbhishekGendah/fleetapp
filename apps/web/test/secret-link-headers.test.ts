import { INVITE_ACCEPT_PATH } from "@fleetapp/core";
import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";
import { RENTER_LINK_PATH, RESET_PASSWORD_PATH } from "../src/lib/paths";

describe("pages whose address holds a secret", () => {
  // next.config cannot import app code, so its list is checked here: renaming
  // a page must not quietly drop the header.
  it("send no referrer, so the secret is never passed on", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const noReferrerSources = rules
      .filter((rule) =>
        rule.headers.some(
          (header) => header.key === "Referrer-Policy" && header.value === "no-referrer",
        ),
      )
      .map((rule) => rule.source);

    expect(noReferrerSources).toContain(`${INVITE_ACCEPT_PATH}/:token*`);
    expect(noReferrerSources).toContain(RESET_PASSWORD_PATH);
    expect(noReferrerSources).toContain(`${RENTER_LINK_PATH}/:token*`);
  });

  it("keep Renter link pages out of caches and search engines", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const renterRule = rules.find(
      (rule) =>
        rule.source === `${RENTER_LINK_PATH}/:token*` &&
        rule.headers.some((header) => header.key === "Cache-Control"),
    );
    expect(renterRule?.headers).toEqual(
      expect.arrayContaining([
        { key: "Cache-Control", value: "no-store" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ]),
    );
  });
});
