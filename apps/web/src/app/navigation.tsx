"use client";

import { cn } from "@fleetapp/ui/cn";
import { Car, House, Settings, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { CARS_PATH, HOME_PATH, SETTINGS_PATH } from "../lib/paths";

interface NavigationItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * The app's sections, in order. Only sections that exist are listed: each
 * later phase adds its own (Vehicles, Renters, Rentals...).
 */
const NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { href: HOME_PATH, label: "Home", icon: House },
  { href: CARS_PATH, label: "Cars", icon: Car },
  { href: SETTINGS_PATH, label: "Settings", icon: Settings },
];

/** A section is current on its own page and the pages under it, not on "/settings-x". */
function isCurrent(pathname: string, href: string): boolean {
  if (href === HOME_PATH) {
    return pathname === HOME_PATH;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** On a wider screen: a column down the left. */
export function SidebarNavigation() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAVIGATION_ITEMS.map((item) => {
        const isActive = isCurrent(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium",
              isActive
                ? "bg-primary-soft text-teal"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
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

/** On a phone: a bar along the bottom, within reach of a thumb. */
export function TabBarNavigation() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="bg-card fixed inset-x-0 bottom-0 z-10 grid border-t pb-[env(safe-area-inset-bottom)] md:hidden"
      style={{ gridTemplateColumns: `repeat(${NAVIGATION_ITEMS.length}, minmax(0, 1fr))` }}
    >
      {NAVIGATION_ITEMS.map((item) => {
        const isActive = isCurrent(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-medium",
              isActive ? "text-teal" : "text-muted-foreground",
            )}
          >
            <item.icon className="size-6" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
