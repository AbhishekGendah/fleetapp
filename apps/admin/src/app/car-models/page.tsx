import { pageOfRows, parseListQuery } from "@fleetapp/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { DataList } from "@fleetapp/ui/data-list";
import Link from "next/link";

import { appDb } from "../../lib/app-db";
import { listMakes, listUnlistedCars } from "../../lib/car-models/car-model-queries";
import { CAR_MODELS_PATH, carMakePath, TYPED_BY_OPERATORS_PATH } from "../../lib/paths";
import { requireAdmin } from "../../lib/require-admin";
import { AdminShell } from "../admin-shell";
import { createMakeAction } from "./actions";
import { CatalogueEntryForm } from "./catalogue-entry-form";
import { MAKE_LIST, MAKE_LIST_RULES } from "./catalogue-lists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The shared car list: every change here reaches every Operator's car form at once. */
export default async function CarModelsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const query = parseListQuery(MAKE_LIST, await props.searchParams);
  const [makes, unlisted] = await Promise.all([listMakes(appDb), listUnlistedCars(appDb)]);

  return (
    <AdminShell>
      <h1 className="text-xl font-semibold">Car models</h1>
      <p className="text-muted-foreground text-sm">
        The makes and models every Operator&rsquo;s car form suggests. Changes apply to every
        Operator straight away. Cars already saved keep the words they were saved with.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Typed by Operators</CardTitle>
          <CardDescription>
            {unlisted.length === 0
              ? "Every car's make and model is in the list."
              : `${unlisted.length} ${unlisted.length === 1 ? "car has" : "cars have"} a make or model not in the list.`}{" "}
            <Link
              href={TYPED_BY_OPERATORS_PATH}
              className="text-teal font-semibold hover:underline"
            >
              Review
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>

      <DataList
        definition={MAKE_LIST}
        page={pageOfRows(makes, MAKE_LIST_RULES, query)}
        query={query}
        basePath={CAR_MODELS_PATH}
        rowKey={(make) => make.id}
        rowHref={(make) => carMakePath(make.id)}
        itemName={{ one: "make", many: "makes" }}
        searchLabel="Search makes and their other names"
        emptyMessage="No makes match."
      />

      <Card>
        <CardHeader>
          <CardTitle>Add a make</CardTitle>
        </CardHeader>
        <CardContent>
          <CatalogueEntryForm
            nameLabel="Make"
            initialValues={{ name: "", aliases: "" }}
            action={createMakeAction}
            submitLabel="Add make"
          />
        </CardContent>
      </Card>
    </AdminShell>
  );
}
