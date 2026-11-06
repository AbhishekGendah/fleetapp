import { FileText, History, LayoutList, Wallet } from "lucide-react";

import { rentalPath } from "../../../lib/paths";
import { recordTabs, type RecordTab } from "../../../lib/record-tabs";

/**
 * One rental's tabs (docs/plans/look-and-feel.md, "One rental's page").
 * Overview is first, so the page's plain address and an old `?tab=summary`
 * both open it.
 */
export const RENTAL_TABS = [
  { key: "overview", label: "Overview", icon: LayoutList },
  { key: "money", label: "Money", icon: Wallet },
  { key: "papers", label: "Papers", icon: FileText },
  { key: "log", label: "Log", icon: History },
] as const satisfies readonly [RecordTab, ...RecordTab[]];

export const RENTAL_TAB_LINKS = recordTabs(RENTAL_TABS, rentalPath);

export type RentalTabKey = (typeof RENTAL_TABS)[number]["key"];
