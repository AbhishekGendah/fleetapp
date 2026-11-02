"use client";

import { SerwistProvider } from "@serwist/turbopack/react";
import type { ReactNode } from "react";

import { SERVICE_WORKER_SCOPE, SERVICE_WORKER_URL } from "../../../../service-worker/cache-names";

/**
 * Turns on the handover's service worker (src/service-worker), so this page
 * opens with no signal once visited. Off while developing, where pages
 * change with every edit. The page never reloads itself when signal returns:
 * the checklist sends what is waiting instead.
 */
export function OfflineReady({ children }: { children: ReactNode }) {
  return (
    <SerwistProvider
      swUrl={SERVICE_WORKER_URL}
      disable={process.env.NODE_ENV === "development"}
      cacheOnNavigation={false}
      reloadOnOnline={false}
      options={{ scope: SERVICE_WORKER_SCOPE }}
    >
      {children}
    </SerwistProvider>
  );
}
