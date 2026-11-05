import type { Metadata } from "next";
import { PageHeader } from "@fleetapp/ui/page-header";

import { RenterPrivacyNotice } from "../../components/renter-privacy-notice";
import { appDb } from "../../lib/app-db";
import { RENTERS_PATH } from "../../lib/paths";
import { loadNoticeBusiness } from "../../lib/privacy/notice-business";
import { requireUser } from "../../lib/require-user";
import { AppShell } from "../app-shell";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Privacy notice" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The privacy notice the business's Renters are given, in the same words as
 * on their links: to show or print for a Renter who has no email.
 */
export default async function PrivacyNoticePage() {
  const user = await requireUser();
  const business = await loadNoticeBusiness(appDb, user.operatorId);
  return (
    <AppShell user={user}>
      <PageHeader backHref={RENTERS_PATH} backLabel="Renters" title="Privacy notice for Renters" />
      <p className="text-muted-foreground text-sm">
        Show this to a Renter, or print it (your browser&rsquo;s Print) and hand it over.
      </p>
      <RenterPrivacyNotice business={business} place="counter" />
    </AppShell>
  );
}
