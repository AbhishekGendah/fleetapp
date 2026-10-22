import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not pre-built JS, so Next
  // needs to transpile them through its own build pipeline.
  transpilePackages: ["@fleetapp/ui", "@fleetapp/db", "@fleetapp/core", "@fleetapp/auth"],

  async headers() {
    return [
      {
        // An invite's secret is in its address. No referrer means clicking any
        // link on the page does not hand that address to another site.
        source: "/invite/:token*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
