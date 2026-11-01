import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not pre-built JS, so Next
  // needs to transpile them through its own build pipeline.
  transpilePackages: [
    "@fleetapp/ui",
    "@fleetapp/db",
    "@fleetapp/core",
    "@fleetapp/email",
    "@fleetapp/auth",
  ],

  async headers() {
    return [
      // Staff-only pages: never shown inside another site (a trick to make a
      // signed-in Admin click Suspend), never indexed, no address passed on.
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
