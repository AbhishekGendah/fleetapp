import { INVITE_ACCEPT_PATH } from "@fleetapp/core";
import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";
import { RESET_PASSWORD_PATH } from "../src/lib/paths";

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
  });
});
