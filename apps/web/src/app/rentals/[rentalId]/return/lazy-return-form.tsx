"use client";

import dynamic from "next/dynamic";

/**
 * The return's last step, loaded only once the checklist is complete: its
 * date and time picker is most of the page's weight, and the step needs
 * signal anyway (the report is made on the server).
 */
export const LazyReturnForm = dynamic(
  () => import("./return-form").then((module) => module.ReturnForm),
  { loading: () => <p className="text-muted-foreground text-sm">Loading the last step…</p> },
);
