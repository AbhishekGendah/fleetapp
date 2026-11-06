import { cn } from "@fleetapp/ui/cn";
import { ExpiringImage } from "@fleetapp/ui/expiring-image";
import { Logo, LogoMark } from "@fleetapp/ui/logo";
import { PAGE_GUTTER_CLASSES, PAGE_WIDTH_CLASSES } from "@fleetapp/ui/page-width";
import Link from "next/link";

import { loadOperatorLogoUrl } from "../lib/files/operator-logo";
import { accountInitial } from "../lib/navigation/account-initial";
import { HOME_PATH } from "../lib/paths";
import type { SignedInUser } from "../lib/require-user";
import { SidebarNavigation, TabBarNavigation } from "./navigation";
import { AccountMenu } from "../components/account-menu";
import { HeaderSearch } from "../components/header-search";
import { PhoneWeekLimit } from "../components/phone-week-limit";

/**
 * The frame around every signed-in page. Designed at phone width first: a
 * top bar and a tab bar along the bottom; from tablet width up, a side menu
 * instead of the tab bar. The top bar and the side menu stay put while the
 * page scrolls.
 */
export async function AppShell({
  user,
  children,
  strip,
  isWide = false,
}: {
  user: SignedInUser;
  children: React.ReactNode;
  /**
   * A single-item page's navy strip (RecordStrip), edge to edge between the
   * top bar and the page's content.
   */
  strip?: React.ReactNode;
  /** Uses the whole screen's width, for a page that shows more the wider it is (the timeline). */
  isWide?: boolean;
}) {
  const logoUrl = await loadOperatorLogoUrl(user.operatorId);
  return (
    <div className="flex min-h-dvh">
      <PhoneWeekLimit />
      {/* Stays in view as the page scrolls, with its own scroll if the screen is short. */}
      <aside className="bg-card sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 self-start overflow-y-auto border-r p-4 md:flex">
        {/* The logo goes home, as on the admin site (Abhi's suggestion, 6 Nov). */}
        {/* The spoken name keeps the logo's visible words (WCAG 2.5.3), then says where it goes. */}
        <Link href={HOME_PATH} className="flex min-h-11 items-center px-2">
          <Logo />
          <span className="sr-only">, home</span>
        </Link>
        <SidebarNavigation />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-card sticky top-0 z-30 border-b">
          <div className="flex min-h-15 items-center gap-3 px-4 py-2 md:px-7">
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
              <span className="text-primary truncate font-extrabold md:text-lg">
                {user.operatorName}
              </span>
            </div>
            {/* The middle: the search box (its button on a phone), and the space that pushes the account button right. */}
            <div className="flex min-w-0 flex-1 justify-end md:justify-center">
              <HeaderSearch />
            </div>
            <AccountMenu initial={accountInitial(user)} />
          </div>
        </header>

        {strip}

        {/* Bottom padding keeps the last thing on the page clear of the tab bar. */}
        <main
          className={cn(
            "flex flex-col gap-4 pt-4 pb-24 md:pt-8 md:pb-8",
            PAGE_GUTTER_CLASSES,
            isWide ? "w-full" : PAGE_WIDTH_CLASSES,
          )}
        >
          {children}
        </main>
      </div>

      <TabBarNavigation />
    </div>
  );
}
