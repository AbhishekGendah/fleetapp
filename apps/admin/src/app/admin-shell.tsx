import { Logo } from "@fleetapp/ui/logo";
import Link from "next/link";

import { isDevOutboxEnabled } from "../lib/email";
import { ADMIN_LABEL } from "./admin-label";
import { SignOutButton } from "@fleetapp/ui/sign-out-button";
import { COMPONENTS_PATH, DEV_OUTBOX_PATH, OPERATORS_PATH, SIGN_IN_PATH } from "../lib/paths";

const NAV_LINK_CLASS =
  "flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground";

/** The frame around every signed-in page. Mobile-first: one column at 375px. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="bg-card border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2">
          <Link href={OPERATORS_PATH}>
            <Logo label={ADMIN_LABEL} />
          </Link>
          <SignOutButton signInHref={SIGN_IN_PATH} />
        </div>
        <nav aria-label="Main" className="mx-auto flex max-w-5xl flex-wrap gap-1 px-2 pb-1">
          <Link href={OPERATORS_PATH} className={NAV_LINK_CLASS}>
            Operators
          </Link>
          {isDevOutboxEnabled ? (
            <Link href={DEV_OUTBOX_PATH} className={NAV_LINK_CLASS}>
              Test inbox
            </Link>
          ) : null}
          <Link href={COMPONENTS_PATH} className={NAV_LINK_CLASS}>
            Components
          </Link>
        </nav>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">{children}</main>
    </div>
  );
}
