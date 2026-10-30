import { Card, CardContent } from "@fleetapp/ui/card";
import { PageHeader } from "@fleetapp/ui/page-header";

import { appDb } from "../../../../lib/app-db";
import { INSURANCE_PATH } from "../../../../lib/paths";
import { requireUser } from "../../../../lib/require-user";
import { emptyPolicyForm } from "../../../../lib/vehicles/paperwork-input";
import { listCarChoices } from "../../../../lib/vehicles/paperwork-queries";
import { AppShell } from "../../../app-shell";
import { PolicyForm } from "../../policy-form";
import { createPolicyAction } from "../actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewPolicyPage() {
  const user = await requireUser();
  const cars = await listCarChoices(appDb, user.operatorId);
  return (
    <AppShell user={user}>
      <PageHeader backHref={INSURANCE_PATH} backLabel={"Insurance"} title="Add a policy" />
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <PolicyForm
            initialValues={emptyPolicyForm()}
            action={createPolicyAction}
            submitLabel="Add policy"
            carChoices={cars}
            isGstRegistered={user.isGstRegistered}
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}
