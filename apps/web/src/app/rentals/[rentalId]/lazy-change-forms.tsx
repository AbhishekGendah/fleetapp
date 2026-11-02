"use client";

import dynamic from "next/dynamic";

const loading = () => <p className="text-muted-foreground text-sm">Loading the form…</p>;

/**
 * The change forms, loaded only when their pop-up opens: the date and time
 * picker and the money box are most of their weight, and the rental page
 * (and every page that links to it, as links are fetched ahead) stays light.
 */
export const LazyEndChangeForm = dynamic(
  () => import("./change-forms").then((module) => module.EndChangeForm),
  { loading },
);

export const LazyOngoingChangeForm = dynamic(
  () => import("./change-forms").then((module) => module.OngoingChangeForm),
  { loading },
);

export const LazyRateChangeForm = dynamic(
  () => import("./change-forms").then((module) => module.RateChangeForm),
  { loading },
);
