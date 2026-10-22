import { describe, expect, it } from "vitest";

import { generateSecretToken, hashSecretToken } from "./secret-tokens";

const URL_SAFE = /^[A-Za-z0-9_-]+$/;
const SHA256_HEX_LENGTH = 64;

describe("secret tokens", () => {
  it("are URL-safe and different every time", () => {
    const first = generateSecretToken();
    const second = generateSecretToken();

    expect(first).toMatch(URL_SAFE);
    expect(first).not.toBe(second);
  });

  it("hash to the same fingerprint every time, which is not the token", () => {
    const token = generateSecretToken();

    expect(hashSecretToken(token)).toBe(hashSecretToken(token));
    expect(hashSecretToken(token)).not.toContain(token);
    expect(hashSecretToken(token)).toHaveLength(SHA256_HEX_LENGTH);
  });

  it("give different tokens different fingerprints", () => {
    expect(hashSecretToken(generateSecretToken())).not.toBe(hashSecretToken(generateSecretToken()));
  });
});
