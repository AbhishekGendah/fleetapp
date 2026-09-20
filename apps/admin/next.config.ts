import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not pre-built JS, so Next
  // needs to transpile them through its own build pipeline.
  transpilePackages: ["@fleetapp/ui", "@fleetapp/db"],
};

export default nextConfig;
