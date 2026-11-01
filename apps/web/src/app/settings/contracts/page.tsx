import { CONTRACT_TEMPLATE_KIND_LABELS, formatDayInTimeZone } from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { PageHeader } from "@fleetapp/ui/page-header";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import Link from "next/link";

import { appDb } from "../../../lib/app-db";
import { listTemplates } from "../../../lib/contracts/templates";
import { contractTemplatePath, SETTINGS_PATH } from "../../../lib/paths";
import { requireUser } from "../../../lib/require-user";
import { AppShell } from "../../app-shell";
import { addTemplateAction } from "./actions";
import { AddTemplateForm } from "./add-template-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The Operator's contract templates, and a way to add one. */
export default async function ContractTemplatesPage() {
  const user = await requireUser();
  const templates = await listTemplates(appDb, user.operatorId);

  return (
    <AppShell user={user}>
      <PageHeader backHref={SETTINGS_PATH} backLabel="Settings" title="Contracts" />
      <Card>
        <CardHeader>
          <CardTitle>Your templates</CardTitle>
          <CardDescription>
            Write your contract once; each rental fills in its own details. Editing makes a new
            version, and anything already signed keeps the version it used.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No templates yet. Add one below: it starts with a layout and headings for you to fill
              in with your own terms.
            </p>
          ) : (
            <RecordList label="Contract templates">
              {templates.map((template) => (
                <RecordItem
                  key={template.id}
                  title={
                    <Link href={contractTemplatePath(template.id)} className="text-teal underline">
                      {template.name}
                    </Link>
                  }
                  aside={
                    template.isDefault ? <Badge tone="good">Used for new rentals</Badge> : null
                  }
                  details={`${CONTRACT_TEMPLATE_KIND_LABELS[template.kind]} · version ${template.latestVersion} · changed ${formatDayInTimeZone(template.updatedAt, user.operatorTimezone)}`}
                />
              ))}
            </RecordList>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Add a template</CardTitle>
          <CardDescription>
            We give you the layout, not the legal wording: write your own terms, and have the
            finished contract checked by a lawyer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddTemplateForm action={addTemplateAction} />
        </CardContent>
      </Card>
    </AppShell>
  );
}
