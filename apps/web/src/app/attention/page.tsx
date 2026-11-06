import type { Metadata } from "next";
import { pageOfRows, parseListQuery } from "@fleetapp/core";
import { Card, CardDescription, CardHeader } from "@fleetapp/ui/card";
import { DataList } from "@fleetapp/ui/data-list";
import { PageHeader } from "@fleetapp/ui/page-header";

import { appDb } from "../../lib/app-db";
import { attentionList } from "../../lib/dashboard/attention-items";
import { loadAttentionSources } from "../../lib/dashboard/attention-sources";
import { MOST_OF_A_KIND } from "../../lib/dashboard/fleet-overview";
import { canHearRenterPayments } from "../../lib/payments/app-payments";
import { ATTENTION_PATH, HOME_PATH } from "../../lib/paths";
import { requireUser } from "../../lib/require-user";
import { AppShell } from "../app-shell";
import { ATTENTION_LIST, ATTENTION_LIST_RULES } from "./attention-list";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Needs attention" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_TITLE = "Needs attention";

/**
 * Everything that needs the Operator's attention, most urgent first, 25 to
 * a page, with search and a filter by kind (the dashboard shows the top
 * five). A list held in memory: each kind is loaded whole, then merged.
 */
export default async function AttentionPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const query = parseListQuery(ATTENTION_LIST, await props.searchParams);
  const clock = { timeZone: user.operatorTimezone, now: new Date() };
  const sources = await loadAttentionSources(appDb, user.operatorId, {
    clock,
    limitPerKind: MOST_OF_A_KIND,
    reach: { canHearRenterPayments },
  });
  const { items } = attentionList(sources, user.operatorTimezone);

  return (
    <AppShell user={user}>
      <PageHeader backHref={HOME_PATH} backLabel="Home" title={PAGE_TITLE} />
      {items.length > 0 ? (
        <DataList
          definition={ATTENTION_LIST}
          page={pageOfRows(items, ATTENTION_LIST_RULES, query)}
          query={query}
          basePath={ATTENTION_PATH}
          rowKey={(item) => item.key}
          hasRowLinksInCells
          itemName={{ one: "thing", many: "things" }}
          searchLabel="Search by name, rego or what's wrong"
          emptyMessage="Nothing matches. Try a different search or kind."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardDescription>Nothing needs attention. Nice.</CardDescription>
          </CardHeader>
        </Card>
      )}
    </AppShell>
  );
}
