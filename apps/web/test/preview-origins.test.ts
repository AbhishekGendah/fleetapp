import { previewTrustedOrigins } from "@fleetapp/auth";
import { describe, expect, it } from "vitest";

const DEPLOYMENT_HOST = "fleetapp-web-abc123-ags.vercel.app";
const BRANCH_HOST = "fleetapp-web-git-claude-branch-ags.vercel.app";

describe("previewTrustedOrigins", () => {
  it("trusts a development preview's own Vercel addresses", () => {
    expect(
      previewTrustedOrigins({
        appStage: "development",
        vercelEnv: "preview",
        deploymentHosts: [DEPLOYMENT_HOST, BRANCH_HOST],
      }),
    ).toEqual([`https://${DEPLOYMENT_HOST}`, `https://${BRANCH_HOST}`]);
  });

  it("trusts nothing extra in production, even on a preview build", () => {
    expect(
      previewTrustedOrigins({
        appStage: "production",
        vercelEnv: "preview",
        deploymentHosts: [DEPLOYMENT_HOST],
      }),
    ).toEqual([]);
  });

  it("trusts nothing extra without APP_STAGE", () => {
    expect(
      previewTrustedOrigins({ vercelEnv: "preview", deploymentHosts: [DEPLOYMENT_HOST] }),
    ).toEqual([]);
  });

  it("trusts nothing extra on the dev site itself (Vercel's production build)", () => {
    expect(
      previewTrustedOrigins({
        appStage: "development",
        vercelEnv: "production",
        deploymentHosts: [DEPLOYMENT_HOST],
      }),
    ).toEqual([]);
  });

  it("ignores missing, duplicate and non-Vercel addresses", () => {
    expect(
      previewTrustedOrigins({
        appStage: "development",
        vercelEnv: "preview",
        deploymentHosts: [
          undefined,
          DEPLOYMENT_HOST,
          DEPLOYMENT_HOST.toUpperCase(),
          "evil.example.com",
          "evil.example.com/.vercel.app",
          "vercel.app.evil.example.com",
        ],
      }),
    ).toEqual([`https://${DEPLOYMENT_HOST}`]);
  });
});
