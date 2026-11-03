"use client";

import {
  TIMELINE_STATUS_GROUPS,
  TIMELINE_ZOOMS,
  type TimelineStatusGroup,
  type TimelineZoom,
} from "@fleetapp/core";
import { parseAsArrayOf, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";

/** The timeline's choices, kept in the page address so a refresh or a shared link keeps them. */
const FILTER_PARSERS = {
  q: parseAsString.withDefault(""),
  show: parseAsStringLiteral(TIMELINE_STATUS_GROUPS).withDefault("all"),
  cars: parseAsArrayOf(parseAsString).withDefault([]),
  zoom: parseAsStringLiteral(TIMELINE_ZOOMS).withDefault("days"),
};

export interface TimelineFilters {
  search: string;
  show: TimelineStatusGroup;
  carIds: readonly string[];
  zoom: TimelineZoom;
}

/** Reads and changes the choices in the browser only: nothing reloads. */
export function useTimelineFilters(): {
  filters: TimelineFilters;
  setFilters: (changes: Partial<TimelineFilters>) => void;
  clearFilters: () => void;
} {
  const [params, setParams] = useQueryStates(FILTER_PARSERS, { history: "replace" });
  return {
    filters: { search: params.q, show: params.show, carIds: params.cars, zoom: params.zoom },
    setFilters: (changes) =>
      void setParams({
        ...(changes.search === undefined ? {} : { q: changes.search }),
        ...(changes.show === undefined ? {} : { show: changes.show }),
        ...(changes.carIds === undefined ? {} : { cars: [...changes.carIds] }),
        ...(changes.zoom === undefined ? {} : { zoom: changes.zoom }),
      }),
    // The zoom is how it is looked at, not which cars: it stays.
    clearFilters: () => void setParams({ q: null, show: null, cars: null }),
  };
}
