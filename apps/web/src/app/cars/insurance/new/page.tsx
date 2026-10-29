import { Card, CardContent, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { appDb } from "../../../../lib/app-db";
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
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Add a policy</CardTitle>
        </CardHeader>
        <CardContent>
          <PolicyForm
            initialValues={emptyPolicyForm()}
            action={createPolicyAction}
            submitLabel="Add policy"
            carChoices={cars}
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}
