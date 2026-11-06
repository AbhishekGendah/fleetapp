"use client";

import { Menu } from "@fleetapp/ui/menu";
import { signOutLabel, useSignOut } from "@fleetapp/ui/sign-out-button";
import { Building2, LogOut, Settings } from "lucide-react";
import Link from "next/link";

import { BUSINESS_DETAILS_PATH, SETTINGS_PATH } from "../lib/paths";
import { PHONE_SIGN_OUT } from "./phone-sign-out-button";

/**
 * The round account button at the right of the top bar: the User's initial
 * on navy, opening Business details, Settings and Sign out. Signing out
 * works as the Sign out button did: it warns about photos not yet sent and
 * wipes the phone. Its warning sits outside the menu, which closes on choosing.
 */
export function AccountMenu({ initial }: { initial: string }): React.JSX.Element {
  const { handleSignOut, isSigningOut, feedback } = useSignOut(PHONE_SIGN_OUT);
  return (
    <div className="flex shrink-0 items-center gap-2">
      {feedback}
      <Menu
        trigger={<span aria-hidden>{initial}</span>}
        triggerLabel="Account menu"
        triggerClassName="bg-primary text-primary-foreground hover:bg-primary-dark focus-visible:ring-ring flex size-11 items-center justify-center rounded-full text-base font-extrabold outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        items={[
          {
            kind: "link",
            label: "Business details",
            href: BUSINESS_DETAILS_PATH,
            icon: <Building2 aria-hidden />,
          },
          { kind: "link", label: "Settings", href: SETTINGS_PATH, icon: <Settings aria-hidden /> },
          { kind: "separator", key: "before-sign-out" },
          {
            kind: "action",
            label: signOutLabel(isSigningOut),
            onSelect: () => void handleSignOut(),
            isDisabled: isSigningOut,
            icon: <LogOut aria-hidden />,
          },
        ]}
        linkComponent={Link}
      />
    </div>
  );
}
