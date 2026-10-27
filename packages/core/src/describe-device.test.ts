import { describe, expect, it } from "vitest";

import { describeDevice } from "./describe-device";

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const EDGE_WINDOWS = `${CHROME_WINDOWS} Edg/130.0.0.0`;
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const FIREFOX_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

describe("describing a device", () => {
  it("names the browser and the system", () => {
    expect(describeDevice(CHROME_WINDOWS)).toBe("Chrome on Windows");
    expect(describeDevice(SAFARI_IPHONE)).toBe("Safari on an iPhone");
    expect(describeDevice(FIREFOX_MAC)).toBe("Firefox on a Mac");
  });

  it("is not fooled by browsers that also claim to be Chrome or Safari", () => {
    expect(describeDevice(EDGE_WINDOWS)).toBe("Edge on Windows");
  });

  it("calls Android Android, though it also says Linux", () => {
    expect(describeDevice(CHROME_ANDROID)).toBe("Chrome on Android");
  });

  it("says so when it cannot tell", () => {
    expect(describeDevice(undefined)).toBe("An unrecognised device");
    expect(describeDevice("curl/8.0")).toBe("An unrecognised device");
  });
});
