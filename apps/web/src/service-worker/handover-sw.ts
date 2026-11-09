/// <reference lib="webworker" />
import { CacheFirst, ExpirationPlugin, NetworkFirst, Serwist } from "serwist";

import { HANDOVER_PAGES_CACHE, STATIC_FILES_CACHE } from "./cache-names";

declare const self: ServiceWorkerGlobalScope;

/** A week, as the phone keeps a checklist at most (rule 25 and the privacy notes). */
const KEPT_SECONDS = 7 * 24 * 60 * 60;
/** How long to wait for the network before showing the copy kept on the phone. */
const NETWORK_WAIT_SECONDS = 4;
/** The handover, return, swap and driver change checklists: all filled in at the car, often with poor signal. */
const HANDOVER_PAGE =
  /^\/rentals\/[^/]+\/(handover|return|swap\/old|swap\/new|driver-change\/check-in)$/;

/**
 * Lets the handover checklist open with poor or no signal once it has been
 * visited (rule 25). Only that page, and the app's own script and style
 * files, are kept: no other page, so no other Renter's details, is stored
 * on the phone. Nothing is saved up front.
 */
const serwist = new Serwist({
  precacheEntries: [],
  skipWaiting: true,
  clientsClaim: true,
  runtimeCaching: [
    {
      matcher: ({ url, request, sameOrigin }) =>
        sameOrigin && request.method === "GET" && HANDOVER_PAGE.test(url.pathname),
      handler: new NetworkFirst({
        cacheName: HANDOVER_PAGES_CACHE,
        networkTimeoutSeconds: NETWORK_WAIT_SECONDS,
        plugins: [new ExpirationPlugin({ maxAgeSeconds: KEPT_SECONDS })],
      }),
    },
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: STATIC_FILES_CACHE,
        plugins: [new ExpirationPlugin({ maxAgeSeconds: KEPT_SECONDS, maxEntries: 200 })],
      }),
    },
  ],
});

serwist.addEventListeners();
