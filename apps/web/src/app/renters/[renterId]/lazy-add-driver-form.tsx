"use client";

import dynamic from "next/dynamic";

/**
 * The Add a driver form, loaded only when a business's Drivers tab shows
 * it: a person's page has the same address, so would otherwise download a
 * form (its picker and choice cards) it never shows (rule 33).
 */
export const LazyAddDriverForm = dynamic(
  () => import("./add-driver-form").then((module) => module.AddDriverForm),
  { loading: () => <p className="text-muted-foreground text-sm">Loading the form…</p> },
);
