"use client";

import dynamic from "next/dynamic";

/**
 * The driver change's signing, loaded only once the check-in is complete:
 * the signature pads are most of its weight, and the step needs signal
 * anyway (the reports are made on the server).
 */
export const LazyDriverChangeSigningForm = dynamic(
  () => import("./driver-change-signing-form").then((module) => module.DriverChangeSigningForm),
  { loading: () => <p className="text-muted-foreground text-sm">Loading the signing…</p> },
);
