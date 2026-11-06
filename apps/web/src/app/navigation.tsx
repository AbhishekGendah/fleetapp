"use client";

import { cn } from "@fleetapp/ui/cn";
import { Menu, type MenuEntry } from "@fleetapp/ui/menu";
import {
  CalendarDays,
  Car,
  ClipboardList,
  Ellipsis,
  House,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  currentSection,
  MORE_SECTIONS,
  SECTION_PATHS,
  type AppSection,
} from "../lib/navigation/sections";

interface NavigationItem {
  section: AppSection;
  label: string;
  icon: LucideIcon;
}

/** The app's sections, in order (6 Nov 2026 look). */
const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { section: "home", label: "Home", icon: House },
  { section: "rentals", label: "Rentals", icon: ClipboardList },
  { section: "calendar", label: "Calendar", icon: CalendarDays },
  { section: "cars", label: "Cars", icon: Car },
  { section: "renters", label: "Renters", icon: Users },
  { section: "settings", label: "Settings", icon: Settings },
];

const TAB_ITEMS = NAVIGATION_ITEMS.filter((item) => !MORE_SECTIONS.includes(item.section));
const MORE_ITEMS = NAVIGATION_ITEMS.filter((item) => MORE_SECTIONS.includes(item.section));
/** The phone's tabs plus More. */
const TAB_COUNT = TAB_ITEMS.length + 1;

/** On a wider screen: a column down the left. */
export function SidebarNavigation() {
  const current = currentSection(usePathname());
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAVIGATION_ITEMS.map((item) => {
        const isActive = item.section === current;
        return (
          <Link
            key={item.section}
            href={SECTION_PATHS[item.section]}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm",
              isActive
                ? "bg-primary-soft text-primary font-extrabold"
                : "text-muted-foreground hover:bg-muted hover:text-foreground font-semibold",
            )}
          >
            <item.icon className="size-5" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

const TAB_CLASSES = "flex min-h-14 flex-col items-center justify-center gap-1 text-xs";

function tabStateClasses(isActive: boolean): string {
  return isActive ? "text-primary font-extrabold" : "text-muted-foreground font-semibold";
}

/** The phone's More menu: Calendar and Settings. */
function moreEntries(current: AppSection | null): readonly MenuEntry[] {
  return MORE_ITEMS.map((item) => ({
    kind: "link",
    label: item.label,
    href: SECTION_PATHS[item.section],
    icon: <item.icon aria-hidden />,
    isCurrent: item.section === current,
  }));
}

/** On a phone: a bar along the bottom, within reach of a thumb. Calendar and Settings sit under More. */
export function TabBarNavigation() {
  const current = currentSection(usePathname());
  const isMoreCurrent = current !== null && MORE_SECTIONS.includes(current);
  return (
    <nav
      aria-label="Main"
      className="bg-card fixed inset-x-0 bottom-0 z-10 grid border-t pb-[env(safe-area-inset-bottom)] md:hidden"
      style={{ gridTemplateColumns: `repeat(${TAB_COUNT}, minmax(0, 1fr))` }}
    >
      {TAB_ITEMS.map((item) => {
        const isActive = item.section === current;
        return (
          <Link
            key={item.section}
            href={SECTION_PATHS[item.section]}
            aria-current={isActive ? "page" : undefined}
            className={cn(TAB_CLASSES, tabStateClasses(isActive))}
          >
            <item.icon className="size-6" aria-hidden />
            {item.label}
          </Link>
        );
      })}
      <Menu
        trigger={
          <>
            <Ellipsis className="size-6" aria-hidden />
            More
          </>
        }
        triggerClassName={cn(
          TAB_CLASSES,
          tabStateClasses(isMoreCurrent),
          "focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-inset",
        )}
        side="top"
        items={moreEntries(current)}
        linkComponent={Link}
      />
    </nav>
  );
}
