import { isRecordId, pageOfRows, parseListQuery } from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { PageHeader } from "@fleetapp/ui/page-header";
import { Badge } from "@fleetapp/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { DataList } from "@fleetapp/ui/data-list";
import { notFound } from "next/navigation";

import { appDb } from "../../../lib/app-db";
import { nicknamesForEditing } from "../../../lib/car-models/car-model-input";
import { loadMake } from "../../../lib/car-models/car-model-queries";
import { CAR_MODELS_PATH, carMakePath, carModelPath } from "../../../lib/paths";
import { requireAdmin } from "../../../lib/require-admin";
import { AdminShell } from "../../admin-shell";
import { addModelsAction, setEntryHiddenAction, updateEntryAction } from "../actions";
import { AddModelsForm } from "../add-models-form";
import { CatalogueEntryForm } from "../catalogue-entry-form";
import { MODEL_LIST, MODEL_LIST_RULES } from "../catalogue-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One make: its name and nicknames, its models, and adding more. */
export default async function CarMakePage(props: {
  params: Promise<{ makeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const [{ makeId }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const make = isRecordId(makeId) ? await loadMake(appDb, makeId) : null;
  if (!make) {
    notFound();
  }
  const query = parseListQuery(MODEL_LIST, searchParams);
  const isHidden = make.hiddenAt !== null;

  return (
    <AdminShell>
      <PageHeader
        backHref={CAR_MODELS_PATH}
        backLabel="Car models"
        title={make.name}
        aside={isHidden ? <Badge>Hidden</Badge> : null}
      />

      <Card>
        <CardHeader>
          <CardTitle>Add models</CardTitle>
        </CardHeader>
        <CardContent>
          <AddModelsForm action={addModelsAction.bind(null, make.id)} />
        </CardContent>
      </Card>

      <DataList
        definition={MODEL_LIST}
        page={pageOfRows(make.models, MODEL_LIST_RULES, query)}
        query={query}
        basePath={carMakePath(make.id)}
        rowKey={(model) => model.id}
        rowHref={(model) => carModelPath(make.id, model.id)}
        itemName={{ one: "model", many: "models" }}
        searchLabel="Search models"
        emptyMessage="No models yet. Add some below."
      />

      <Card>
        <CardHeader>
          <CardTitle>Make</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <CatalogueEntryForm
            nameLabel="Make"
            initialValues={{ name: make.name, aliases: nicknamesForEditing(make.aliases) }}
            action={updateEntryAction.bind(null, "make", make.id)}
            submitLabel="Save make"
          />
          <ActionButton
            action={setEntryHiddenAction.bind(null, "make", make.id, !isHidden)}
            label={isHidden ? "Show this make again" : "Hide this make and its models"}
            pendingLabel="Saving…"
          />
        </CardContent>
      </Card>
    </AdminShell>
  );
}
