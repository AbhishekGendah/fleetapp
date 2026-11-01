"use client";

import { NuqsAdapter } from "nuqs/adapters/next/app";
import type * as React from "react";

/** Lets the shared list keep its search and filters in the page address (nuqs). Wraps each app's pages. */
export function QueryAdapter(props: { children: React.ReactNode }): React.JSX.Element {
  return <NuqsAdapter>{props.children}</NuqsAdapter>;
}
