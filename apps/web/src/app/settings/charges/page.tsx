import type { Metadata } from "next";
import { GST_TREATMENT_LABELS } from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Badge } from "@fleetapp/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { FormSection } from "@fleetapp/ui/form-section";
import { PageHeader } from "@fleetapp/ui/page-header";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { Archive, Pencil, Plus, Undo2 } from "lucide-react";

import { appDb } from "../../../lib/app-db";
import { listChargeTypes, type ChargeType } from "../../../lib/ledger/charge-types";
import { SETTINGS_PATH } from "../../../lib/paths";
import { requireUser } from "../../../lib/require-user";
import { AppShell } from "../../app-shell";
import {
  addChargeTypeAction,
  archiveChargeTypeAction,
  restoreChargeTypeAction,
  updateChargeTypeAction,
} from "./actions";
import { ChargeTypeForm, GstTreatmentForm } from "./charge-type-form";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Charges" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ChargeTypeActions({ type }: { type: ChargeType }) {
  const update = updateChargeTypeAction.bind(null, type.id, type.builtIn !== null);
  return (
    <>
      <FormDialog
        triggerLabel={type.builtIn ? "Change GST" : "Edit"}
        title={type.label}
        triggerIcon={<Pencil aria-hidden />}
      >
        {type.builtIn ? (
          <GstTreatmentForm action={update} gstTreatment={type.gstTreatment} />
        ) : (
          <ChargeTypeForm
            action={update}
            initialValues={{ name: type.label, gstTreatment: type.gstTreatment }}
            submitLabel="Save"
          />
        )}
      </FormDialog>
      {type.builtIn ? null : (
        <ActionButton
          action={archiveChargeTypeAction.bind(null, type.id)}
          label="Archive"
          pendingLabel="Archiving…"
          variant="ghost"
          icon={<Archive aria-hidden />}
        />
      )}
    </>
  );
}

/** What the business charges Renters for, each with its GST treatment (rule 9). */
export default async function ChargeTypesPage() {
  const user = await requireUser();
  const allTypes = await listChargeTypes(appDb, user.operatorId);
  const types = allTypes.filter((type) => !type.isArchived);
  const archived = allTypes.filter((type) => type.isArchived);

  return (
    <AppShell user={user}>
      <PageHeader backHref={SETTINGS_PATH} backLabel="Settings" title="Charges" />
      <Card>
        <CardHeader>
          <CardTitle>Charge types</CardTitle>
          <CardDescription>
            Each charge on a Renter&apos;s ledger has a type, and the type says whether it includes
            GST. GST is only added while your business is registered for it (Settings → Business
            details). A change applies to charges added from then on.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RecordList label="Charge types">
            {types.map((type) => (
              <RecordItem
                key={type.id}
                title={type.label}
                aside={type.builtIn ? <Badge>Built in</Badge> : null}
                details={GST_TREATMENT_LABELS[type.gstTreatment]}
                actions={<ChargeTypeActions type={type} />}
              />
            ))}
          </RecordList>
          {archived.length > 0 ? (
            <FormSection title="Archived">
              <RecordList label="Archived charge types">
                {archived.map((type) => (
                  <RecordItem
                    key={type.id}
                    title={type.label}
                    details={GST_TREATMENT_LABELS[type.gstTreatment]}
                    actions={
                      <ActionButton
                        action={restoreChargeTypeAction.bind(null, type.id)}
                        label={`Bring back ${type.label}`}
                        pendingLabel="Bringing back…"
                        icon={<Undo2 aria-hidden />}
                      />
                    }
                  />
                ))}
              </RecordList>
            </FormSection>
          ) : null}
          <FormDialog
            triggerLabel="Add a charge type"
            title="Add a charge type"
            triggerIcon={<Plus aria-hidden />}
            isMainAction
          >
            <ChargeTypeForm
              action={addChargeTypeAction}
              initialValues={{ name: "", gstTreatment: "taxable" }}
              submitLabel="Add charge type"
            />
          </FormDialog>
        </CardContent>
      </Card>
    </AppShell>
  );
}
