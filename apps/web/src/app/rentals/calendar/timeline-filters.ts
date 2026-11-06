"use client";

import {
  TIMELINE_STATUS_GROUPS,
  TIMELINE_ZOOMS,
  type TimelineStatusGroup,
  type TimelineZoom,
} from "@fleetapp/core";
import { parseAsStringLiteral, useQueryStates } from "nuqs";

import { TIMELINE_SHOW_PARAM, TIMELINE_ZOOM_PARAM } from "./calendar-window";

/** The By car view's choices, kept in the page address so a refresh or a shared link keeps them. */
const FILTER_PARSERS = {
  [TIMELINE_SHOW_PARAM]: parseAsStringLiteral(TIMELINE_STATUS_GROUPS).withDefault("all"),
  [TIMELINE_ZOOM_PARAM]: parseAsStringLiteral(TIMELINE_ZOOMS).withDefault("days"),
};

export interface TimelineFilters {
  show: TimelineStatusGroup;
  zoom: TimelineZoom;
}

/** Reads and changes the choices in the browser only: nothing reloads. */
export function useTimelineFilters(): {
  filters: TimelineFilters;
  setFilters: (changes: Partial<TimelineFilters>) => void;
} {
  const [params, setParams] = useQueryStates(FILTER_PARSERS, { history: "replace" });
  return { filters: params, setFilters: (changes) => void setParams(changes) };
}
