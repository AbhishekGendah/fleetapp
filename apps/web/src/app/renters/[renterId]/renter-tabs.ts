import {
  CalendarRange,
  History,
  IdCard,
  LayoutList,
  NotebookPen,
  UserRound,
  UsersRound,
  Wallet,
} from "lucide-react";

import { renterPath } from "../../../lib/paths";
import { recordTabs, type RecordTab } from "../../../lib/record-tabs";

/**
 * One Renter's tabs (docs/plans/look-and-feel.md, "Cars and Renters pages"),
 * in the mockup's order. Overview is first, so the page's plain address opens
 * it; Details keeps its own `?tab=details` address.
 */
export const RENTER_TABS = [
  { key: "overview", label: "Overview", icon: LayoutList },
  { key: "rentals", label: "Rentals", icon: CalendarRange },
  { key: "money", label: "Money", icon: Wallet },
  { key: "details", label: "Details", icon: UserRound },
  { key: "licence", label: "Licence", icon: IdCard },
  { key: "notes", label: "Notes", icon: NotebookPen },
  { key: "log", label: "Log", icon: History },
] as const satisfies readonly [RecordTab, ...RecordTab[]];

export const RENTER_TAB_LINKS = recordTabs(RENTER_TABS, renterPath);

export type RenterTabKey = (typeof RENTER_TABS)[number]["key"];

/**
 * A business Renter's tabs (7 Nov 2026 mockups): its drivers in place of a
 * licence, which a business doesn't have. Each address is the same as the
 * person's tab of that name.
 */
export const BUSINESS_TABS = [
  { key: "overview", label: "Overview", icon: LayoutList },
  { key: "drivers", label: "Drivers", icon: UsersRound },
  { key: "rentals", label: "Rentals", icon: CalendarRange },
  { key: "money", label: "Money", icon: Wallet },
  { key: "details", label: "Details", icon: UserRound },
  { key: "notes", label: "Notes", icon: NotebookPen },
  { key: "log", label: "Log", icon: History },
] as const satisfies readonly [RecordTab, ...RecordTab[]];

export const BUSINESS_TAB_LINKS = recordTabs(BUSINESS_TABS, renterPath);

export type BusinessTabKey = (typeof BUSINESS_TABS)[number]["key"];
