import {
  CARS_PATH,
  HOME_PATH,
  RENTALS_CALENDAR_PATH,
  RENTALS_PATH,
  RENTALS_TIMELINE_PATH,
  RENTERS_PATH,
  SETTINGS_PATH,
} from "../paths";

/** The app's main sections, in menu order. */
export type AppSection = "home" | "rentals" | "calendar" | "cars" | "renters" | "settings";

/** Where each section's menu item goes. */
export const SECTION_PATHS: Readonly<Record<AppSection, string>> = {
  home: HOME_PATH,
  rentals: RENTALS_PATH,
  calendar: RENTALS_CALENDAR_PATH,
  cars: CARS_PATH,
  renters: RENTERS_PATH,
  settings: SETTINGS_PATH,
};

/** A page under `href`, or `href` itself; not "/settings-x" for "/settings". */
function isAtOrUnder(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Which section a page belongs to, for marking its menu item current.
 * The calendar and the timeline (its By car view) live under /rentals but
 * are the Calendar section, so Rentals is not also marked there.
 */
export function currentSection(pathname: string): AppSection | null {
  if (pathname === HOME_PATH) {
    return "home";
  }
  if (
    isAtOrUnder(pathname, RENTALS_CALENDAR_PATH) ||
    isAtOrUnder(pathname, RENTALS_TIMELINE_PATH)
  ) {
    return "calendar";
  }
  const sections: readonly AppSection[] = ["rentals", "cars", "renters", "settings"];
  return sections.find((section) => isAtOrUnder(pathname, SECTION_PATHS[section])) ?? null;
}

/** The sections a phone keeps under More, to leave room in its tab bar. */
export const MORE_SECTIONS: readonly AppSection[] = ["calendar", "settings"];
