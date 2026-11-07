import {
  CalendarRange,
  Camera,
  FileText,
  Gauge,
  History,
  LayoutList,
  ReceiptText,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { carPath } from "../../../lib/paths";
import { recordTabs, type RecordTab } from "../../../lib/record-tabs";

/**
 * One car's tabs (docs/plans/look-and-feel.md, "Cars and Renters pages"),
 * in the mockup's order. Overview is first, so the page's plain address and
 * an old `?tab=details` both open it (the details are a card on it now).
 */
export const CAR_TABS = [
  { key: "overview", label: "Overview", icon: LayoutList },
  { key: "rentals", label: "Rentals", icon: CalendarRange },
  { key: "paperwork", label: "Rego & insurance", icon: ShieldCheck },
  { key: "damage", label: "Damage", icon: TriangleAlert },
  { key: "costs", label: "Costs", icon: ReceiptText },
  { key: "photos", label: "Photos", icon: Camera },
  { key: "documents", label: "Documents", icon: FileText },
  { key: "odometer", label: "Odometer", icon: Gauge },
  { key: "log", label: "Log", icon: History },
] as const satisfies readonly [RecordTab, ...RecordTab[]];

export const CAR_TAB_LINKS = recordTabs(CAR_TABS, carPath);

export type CarTabKey = (typeof CAR_TABS)[number]["key"];
