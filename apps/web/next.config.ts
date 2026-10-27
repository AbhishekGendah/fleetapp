import type { NextConfig } from "next";

const SECRET_LINK_PAGES = ["/invite/:token*", "/reset-password"];

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not pre-built JS, so Next
  // needs to transpile them through its own build pipeline.
  transpilePackages: [
    "@fleetapp/ui",
    "@fleetapp/db",
    "@fleetapp/core",
    "@fleetapp/auth",
    "@fleetapp/email",
  ],

  async headers() {
    return [
      // An invite's or reset link's secret is in its address. No referrer
      // means clicking any link on the page does not hand it to another site.
      ...SECRET_LINK_PAGES.map((source) => ({
        source,
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      })),
    ];
  },
};

export default nextConfig;
