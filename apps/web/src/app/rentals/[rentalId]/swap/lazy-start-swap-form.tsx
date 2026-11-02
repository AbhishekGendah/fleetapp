"use client";

import dynamic from "next/dynamic";

/** The start-swap form, loaded only when its pop-up opens, so the rental page stays light. */
export const LazyStartSwapForm = dynamic(
  () => import("../start-swap-form").then((module) => module.StartSwapForm),
  { loading: () => <p className="text-muted-foreground text-sm">Loading the form…</p> },
);
