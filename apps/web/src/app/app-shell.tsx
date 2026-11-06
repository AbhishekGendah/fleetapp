import { cn } from "@fleetapp/ui/cn";
import { ExpiringImage } from "@fleetapp/ui/expiring-image";
import { Logo, LogoMark } from "@fleetapp/ui/logo";
import Link from "next/link";

import { loadOperatorLogoUrl } from "../lib/files/operator-logo";
import { HOME_PATH } from "../lib/paths";
import type { SignedInUser } from "../lib/require-user";
import { SidebarNavigation, TabBarNavigation } from "./navigation";
import { PhoneSignOutButton } from "../components/phone-sign-out-button";
import { PhoneWeekLimit } from "../components/phone-week-limit";

/**
 * The frame around every signed-in page. Designed at phone width first: a
 * header and a tab bar along the bottom; from tablet width up, a sidebar
 * instead of the tab bar.
 */
export async function AppShell({
  user,
  children,
  isWide = false,
}: {
  user: SignedInUser;
  children: React.ReactNode;
  /** Uses the whole screen's width, for a page that shows more the wider it is (the timeline). */
  isWide?: boolean;
}) {
  const logoUrl = await loadOperatorLogoUrl(user.operatorId);
  return (
    <div className="flex min-h-dvh">
      <PhoneWeekLimit />
      <aside className="bg-card hidden w-60 shrink-0 flex-col gap-6 border-r p-4 md:flex">
        {/* The logo goes home, as on the admin site (Abhi's suggestion, 6 Nov). */}
        {/* The spoken name keeps the logo's visible words (WCAG 2.5.3), then says where it goes. */}
        <Link href={HOME_PATH} className="flex min-h-11 items-center px-2">
          <Logo />
          <span className="sr-only">, home</span>
        </Link>
        <SidebarNavigation />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-card sticky top-0 z-20 border-b">
          <div className="flex items-center justify-between gap-3 px-4 py-2">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                href={HOME_PATH}
                aria-label="Home"
                className="flex min-h-11 items-center md:hidden"
              >
                <LogoMark />
              </Link>
              {logoUrl ? (
                <ExpiringImage src={logoUrl} alt="" className="h-8 max-w-24 shrink-0" />
              ) : null}
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-semibold">{user.operatorName}</span>
                <span className="text-muted-foreground truncate text-xs">{user.email}</span>
              </div>
            </div>
            <PhoneSignOutButton />
          </div>
        </header>

        {/* Bottom padding keeps the last thing on the page clear of the tab bar. */}
        <main
          className={cn(
            "mx-auto flex w-full flex-col gap-4 p-4 pb-24 md:p-8 md:pb-8",
            !isWide && "max-w-5xl",
          )}
        >
          {children}
        </main>
      </div>

      <TabBarNavigation />
    </div>
  );
}
