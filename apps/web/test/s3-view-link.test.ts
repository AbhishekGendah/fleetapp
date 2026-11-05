import { describe, expect, it } from "vitest";

import { createS3FileStorage, VIEW_CACHE_CONTROL } from "../src/lib/storage/s3-file-storage";

// Signing a link happens on this machine; nothing is sent to Amazon.
const storage = createS3FileStorage({
  region: "ap-southeast-2",
  accessKeyId: "made-up-key-id",
  secretAccessKey: "made-up-secret",
  buckets: { general: "made-up-general", identity: "made-up-identity" },
});

describe("view links", () => {
  it("tell the browser to keep no copy of a licence picture (review A7-7)", async () => {
    const url = new URL(await storage.createViewUrl("identity", "operator/licence.jpg"));

    expect(url.searchParams.get("response-cache-control")).toBe(VIEW_CACHE_CONTROL);
  });

  it("keep no copy of a named document either", async () => {
    const url = new URL(await storage.createViewUrl("general", "operator/a.pdf", "Contract.pdf"));

    expect(url.searchParams.get("response-cache-control")).toBe(VIEW_CACHE_CONTROL);
    expect(url.searchParams.get("response-content-disposition")).toContain("Contract.pdf");
  });
});
