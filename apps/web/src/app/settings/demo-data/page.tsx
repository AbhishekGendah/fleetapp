import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { PageHeader } from "@fleetapp/ui/page-header";
import { notFound } from "next/navigation";

import { isDemoDataAllowed } from "../../../lib/demo-data/demo-access";
import { DEMO_STEPS } from "../../../lib/demo-data/demo-steps";
import { SETTINGS_PATH } from "../../../lib/paths";
import { requireUser } from "../../../lib/require-user";
import { AppShell } from "../../app-shell";
import { DemoDataRunner } from "./demo-data-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Each step's request may take this long (seconds): the longest is one handover with its report. */
export const maxDuration = 60;

/** Test sites only: fills the signed-in User's business with made-up records to try things on. */
export default async function DemoDataPage() {
  const user = await requireUser();
  if (!isDemoDataAllowed()) {
    notFound();
  }

  return (
    <AppShell user={user}>
      <PageHeader backHref={SETTINGS_PATH} backLabel="Settings" title="Demo data" />
      <Card>
        <CardHeader>
          <CardTitle>Fill {user.operatorName} with made-up records</CardTitle>
          <CardDescription>
            For testing only, and only on the test site. Adds 50 cars (with rego, insurance,
            purchases, costs and a photo), 40 Renters (licences, made-up scans, notes) and 34
            rentals: out now, booked, drafts and cancelled, with bonds, contracts and handovers.
            Everything is marked as demo data. Emails go to the test inbox. Pressing it again adds
            only what is missing. It takes a few minutes; keep this page open.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DemoDataRunner steps={DEMO_STEPS} />
        </CardContent>
      </Card>
    </AppShell>
  );
}
