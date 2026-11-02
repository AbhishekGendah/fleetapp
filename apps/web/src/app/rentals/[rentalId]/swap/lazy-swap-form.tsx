"use client";

import dynamic from "next/dynamic";

/**
 * The swap's last step, loaded only once the new car's checklist is
 * complete: the signature pad is most of its weight, and the step needs
 * signal anyway (the documents are made on the server).
 */
export const LazySwapForm = dynamic(() => import("./swap-form").then((module) => module.SwapForm), {
  loading: () => <p className="text-muted-foreground text-sm">Loading the last step…</p>,
});
