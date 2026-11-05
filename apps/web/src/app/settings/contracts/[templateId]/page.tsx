import type { Metadata } from "next";
import {
  CONTRACT_TEMPLATE_KIND_LABELS,
  formatDateTimeInTimeZone,
  isRecordId,
  mergeFieldLabel,
  missingRentTermFields,
  type ContractTemplateKind,
  type TemplateDocument,
} from "@fleetapp/core";
import { ACTIVITY_ENTITY_TYPES } from "@fleetapp/db/schema";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Badge } from "@fleetapp/ui/badge";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { PageHeader } from "@fleetapp/ui/page-header";
import { Archive, FileText, Star } from "lucide-react";
import { notFound } from "next/navigation";

import { HistoryCard } from "../../../../components/history-card";
import { appDb } from "../../../../lib/app-db";
import { loadTemplate } from "../../../../lib/contracts/templates";
import { contractTemplatePreviewPath, CONTRACTS_PATH } from "../../../../lib/paths";
import { requireUser } from "../../../../lib/require-user";
import { AppShell } from "../../../app-shell";
import { archiveTemplateAction, makeTemplateDefaultAction, saveTemplateAction } from "../actions";
import { TemplateEditorForm } from "./template-editor-form";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Contract template" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEMPLATE_FIELD_LABELS: Readonly<Record<string, string>> = {
  name: "Name",
  kind: "Kind",
  version: "Version",
  isDefault: "Used for new rentals",
};

/**
 * A contract that leaves out the rent terms Renters agree to: rent in
 * 24-hour blocks, the grace period and re-pricing below the long-term
 * minimum are only enforceable if the contract states them.
 */
function RentTermsWarning(props: { kind: ContractTemplateKind; content: TemplateDocument }) {
  const missing = props.kind === "contract" ? missingRentTermFields(props.content) : [];
  if (missing.length === 0) {
    return null;
  }
  return (
    <p role="status" className="text-attention text-sm font-medium">
      This contract does not state how rent is charged. Add these fields to Term and rent, so
      Renters agree to them: {missing.map((key) => mergeFieldLabel(key)).join(", ")}.
    </p>
  );
}

/** One template: its editor, a PDF preview, its versions, and its Log. */
export default async function ContractTemplatePage(props: {
  params: Promise<{ templateId: string }>;
}) {
  const user = await requireUser();
  const { templateId } = await props.params;
  const template = isRecordId(templateId)
    ? await loadTemplate(appDb, user.operatorId, templateId)
    : null;
  if (!template || template.archivedAt) {
    notFound();
  }

  return (
    <AppShell user={user}>
      <PageHeader
        backHref={CONTRACTS_PATH}
        backLabel="Contracts"
        title={template.name}
        aside={template.isDefault ? <Badge tone="good">Used for new rentals</Badge> : null}
      />
      <p className="text-muted-foreground -mt-2 text-sm">
        {CONTRACT_TEMPLATE_KIND_LABELS[template.kind]} · version {template.latestVersion}
      </p>
      <RentTermsWarning kind={template.kind} content={template.content} />
      <Card>
        <CardContent className="pt-6">
          <TemplateEditorForm
            name={template.name}
            content={template.content}
            action={saveTemplateAction.bind(null, template.id)}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Preview and use</CardTitle>
          <CardDescription>
            The preview shows each field by its name. Save first to preview your latest changes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button asChild variant="outline" className="w-full sm:w-auto sm:self-start">
            <a href={contractTemplatePreviewPath(template.id)} target="_blank" rel="noopener">
              <FileText aria-hidden />
              Preview as PDF
            </a>
          </Button>
          {template.isDefault ? null : (
            <>
              <ActionButton
                action={makeTemplateDefaultAction.bind(null, template.id)}
                label="Use for new rentals"
                pendingLabel="Saving…"
                icon={<Star aria-hidden />}
              />
              <ActionButton
                action={archiveTemplateAction.bind(null, template.id)}
                label="Archive this template"
                pendingLabel="Archiving…"
                icon={<Archive aria-hidden />}
              />
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Versions</CardTitle>
          <CardDescription>Every saved version is kept exactly as it was.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1 text-sm">
            {template.versions.map((version) => (
              <li key={version.id}>
                Version {version.version}:{" "}
                {formatDateTimeInTimeZone(version.createdAt, user.operatorTimezone)}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <HistoryCard
        user={user}
        subjects={[
          { entityType: ACTIVITY_ENTITY_TYPES.contractTemplate, entityIds: [template.id] },
        ]}
        fieldLabel={(field) => TEMPLATE_FIELD_LABELS[field] ?? field}
        describeValue={(field, value) =>
          field === "isDefault" ? (value ? "yes" : "no") : String(value ?? "blank")
        }
      />
    </AppShell>
  );
}
