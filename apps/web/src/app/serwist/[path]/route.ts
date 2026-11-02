import { createSerwistRoute } from "@serwist/turbopack";

/**
 * Serves the handover page's service worker (src/service-worker), built
 * with esbuild when the app is built. Nothing is saved up front: the worker
 * keeps only what the handover page loads (see the worker).
 */
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute(
  {
    swSrc: "src/service-worker/handover-sw.ts",
    useNativeEsbuild: true,
    globPatterns: [],
  },
);
