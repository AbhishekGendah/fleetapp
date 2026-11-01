import type { LucideIcon } from "lucide-react";

/** The address query part that says which tab of a record's page is open. */
export const TAB_PARAM = "tab";

export interface RecordTab {
  key: string;
  label: string;
  icon: LucideIcon;
}

export interface RecordTabs<Key extends string> {
  /** The tab an address asks for, or the first tab if it asks for none or an unknown one. */
  chosen: (value: string | string[] | undefined) => Key;
  /** The address of one tab of one record; the first tab is the page's plain address. */
  href: (recordId: string, tab: Key) => string;
}

/** The tabs of a record's page (a car, a Renter), opened through `?tab=`. */
export function recordTabs<const Tabs extends readonly [RecordTab, ...RecordTab[]]>(
  tabs: Tabs,
  recordPath: (recordId: string) => string,
): RecordTabs<Tabs[number]["key"]> {
  const firstKey = tabs[0].key;
  return {
    chosen: (value) => tabs.find((tab) => tab.key === value)?.key ?? firstKey,
    href: (recordId, tab) =>
      tab === firstKey ? recordPath(recordId) : `${recordPath(recordId)}?${TAB_PARAM}=${tab}`,
  };
}
