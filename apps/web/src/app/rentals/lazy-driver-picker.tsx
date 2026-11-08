"use client";

import dynamic from "next/dynamic";

/**
 * The driver picker, loaded only once a business is chosen: a person's own
 * booking (most of them) never downloads the choice cards it is built on.
 */
export const LazyDriverPicker = dynamic(
  () => import("./driver-picker").then((module) => module.DriverPicker),
  { loading: () => <p className="text-muted-foreground text-sm">Loading its drivers…</p> },
);
