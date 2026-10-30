import { isRecordId } from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { PageHeader } from "@fleetapp/ui/page-header";
import { Badge } from "@fleetapp/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { notFound } from "next/navigation";

import { appDb } from "../../../../lib/app-db";
import { nicknamesForEditing } from "../../../../lib/car-models/car-model-input";
import { loadModel } from "../../../../lib/car-models/car-model-queries";
import { carMakePath } from "../../../../lib/paths";
import { requireAdmin } from "../../../../lib/require-admin";
import { AdminShell } from "../../../admin-shell";
import { setEntryHiddenAction, updateEntryAction } from "../../actions";
import { CatalogueEntryForm } from "../../catalogue-entry-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One model: its name and nicknames, and hiding it. */
export default async function CarModelPage(props: { params: Promise<{ modelId: string }> }) {
  await requireAdmin();
  const { modelId } = await props.params;
  const model = isRecordId(modelId) ? await loadModel(appDb, modelId) : null;
  if (!model) {
    notFound();
  }
  const isHidden = model.hiddenAt !== null;

  return (
    <AdminShell>
      <PageHeader
        backHref={carMakePath(model.makeId)}
        backLabel={model.makeName}
        title={`${model.makeName} ${model.name}`}
        aside={isHidden ? <Badge>Hidden</Badge> : null}
      />
      <Card>
        <CardHeader>
          <CardTitle>Model</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <CatalogueEntryForm
            nameLabel="Model"
            initialValues={{ name: model.name, aliases: nicknamesForEditing(model.aliases) }}
            action={updateEntryAction.bind(null, "model", model.id)}
            submitLabel="Save model"
          />
          <ActionButton
            action={setEntryHiddenAction.bind(null, "model", model.id, !isHidden)}
            label={isHidden ? "Show this model again" : "Hide this model"}
            pendingLabel="Saving…"
          />
        </CardContent>
      </Card>
    </AdminShell>
  );
}
