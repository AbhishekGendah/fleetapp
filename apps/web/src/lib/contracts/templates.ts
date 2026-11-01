import { STARTER_CONTRACT, type ContractTemplateKind, type TemplateDocument } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  contractTemplates,
  contractTemplateVersions,
  type ActivityAction,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";

import { recordUserChange, type ActingUser, type UserChange } from "../acting-user";
import type { NewTemplateInput, TemplateEditInput } from "./template-input";

export interface TemplateSummary {
  id: string;
  kind: ContractTemplateKind;
  name: string;
  isDefault: boolean;
  archivedAt: Date | null;
  latestVersion: number;
  updatedAt: Date;
}

export interface TemplateVersionSummary {
  id: string;
  version: number;
  createdAt: Date;
}

export interface TemplateDetail extends TemplateSummary {
  content: TemplateDocument;
  latestVersionId: string;
  versions: TemplateVersionSummary[];
}

export type TemplateChangeResult = "changed" | "unchanged" | "not_found";

function logTemplateActivity(
  tx: AnyTransaction,
  actor: ActingUser,
  templateId: string,
  action: ActivityAction,
  values: Pick<UserChange, "valuesBefore" | "valuesAfter"> = {},
): Promise<void> {
  return recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.contractTemplate,
    entityId: templateId,
    action,
    ...values,
  });
}

/** The Operator's current template, locked for this transaction. */
async function lockTemplate(tx: AnyTransaction, operatorId: string, templateId: string) {
  const [template] = await tx
    .select()
    .from(contractTemplates)
    .where(
      and(
        eq(contractTemplates.id, templateId),
        eq(contractTemplates.operatorId, operatorId),
        isNull(contractTemplates.archivedAt),
      ),
    )
    .for("update");
  return template;
}

async function latestVersionOf(tx: AnyTransaction, operatorId: string, templateId: string) {
  const [latest] = await tx
    .select()
    .from(contractTemplateVersions)
    .where(
      and(
        eq(contractTemplateVersions.operatorId, operatorId),
        eq(contractTemplateVersions.templateId, templateId),
      ),
    )
    .orderBy(desc(contractTemplateVersions.version))
    .limit(1);
  return latest;
}

/**
 * Whether a version already holds this text. Compared by the database, as
 * stored text keeps no key order and a plain text comparison would see a
 * change where there is none.
 */
async function isSameContent(
  tx: AnyTransaction,
  versionId: string,
  content: TemplateDocument,
): Promise<boolean> {
  const [row] = await tx
    .select({
      isSame: sql<boolean>`${contractTemplateVersions.content} = ${JSON.stringify(content)}::jsonb`,
    })
    .from(contractTemplateVersions)
    .where(eq(contractTemplateVersions.id, versionId));
  return row?.isSame ?? false;
}

/**
 * Adds a template, starting from the starter layout (no legal wording). The
 * first of its kind becomes the default, so new rentals have one to use.
 */
export async function createTemplate(
  database: AnyDatabase,
  actor: ActingUser,
  input: NewTemplateInput,
): Promise<string> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const [existingDefault] = await tx
      .select({ id: contractTemplates.id })
      .from(contractTemplates)
      .where(
        and(
          eq(contractTemplates.operatorId, actor.operatorId),
          eq(contractTemplates.kind, input.kind),
          eq(contractTemplates.isDefault, true),
          isNull(contractTemplates.archivedAt),
        ),
      );
    const [template] = await tx
      .insert(contractTemplates)
      .values({ ...input, operatorId: actor.operatorId, isDefault: !existingDefault })
      .returning({ id: contractTemplates.id });
    if (!template) {
      throw new Error("The template was not saved.");
    }
    await tx.insert(contractTemplateVersions).values({
      operatorId: actor.operatorId,
      templateId: template.id,
      version: 1,
      content: STARTER_CONTRACT,
      createdByUserId: actor.userId,
    });
    await logTemplateActivity(tx, actor, template.id, ACTIVITY_ACTIONS.created, {
      valuesAfter: { ...input, isDefault: !existingDefault, version: 1 },
    });
    return template.id;
  });
}

/**
 * Saves the editor: a changed text becomes the next version (earlier ones
 * are kept as they were, rule 12); a changed name is renamed. Saving the
 * same again writes nothing.
 */
export async function saveTemplate(
  database: AnyDatabase,
  actor: ActingUser,
  templateId: string,
  input: TemplateEditInput,
): Promise<TemplateChangeResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const template = await lockTemplate(tx, actor.operatorId, templateId);
    if (!template) {
      return "not_found";
    }
    const latest = await latestVersionOf(tx, actor.operatorId, templateId);
    const isTextChanged = !latest || !(await isSameContent(tx, latest.id, input.content));
    const isRenamed = template.name !== input.name;
    if (!isTextChanged && !isRenamed) {
      return "unchanged";
    }
    const nextVersion = (latest?.version ?? 0) + 1;
    if (isTextChanged) {
      await tx.insert(contractTemplateVersions).values({
        operatorId: actor.operatorId,
        templateId,
        version: nextVersion,
        content: input.content,
        createdByUserId: actor.userId,
      });
    }
    if (isRenamed) {
      await tx
        .update(contractTemplates)
        .set({ name: input.name })
        .where(eq(contractTemplates.id, templateId));
    }
    // The text itself is the Operator's; the log says a new version was made.
    await logTemplateActivity(tx, actor, templateId, ACTIVITY_ACTIONS.updated, {
      valuesBefore: { ...(isRenamed ? { name: template.name } : {}) },
      valuesAfter: {
        ...(isRenamed ? { name: input.name } : {}),
        ...(isTextChanged ? { version: nextVersion } : {}),
      },
    });
    return "changed";
  });
}

/** Makes this the template of its kind that new rentals use. */
export async function makeTemplateDefault(
  database: AnyDatabase,
  actor: ActingUser,
  templateId: string,
): Promise<TemplateChangeResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const template = await lockTemplate(tx, actor.operatorId, templateId);
    if (!template) {
      return "not_found";
    }
    if (template.isDefault) {
      return "unchanged";
    }
    await tx
      .update(contractTemplates)
      .set({ isDefault: false })
      .where(
        and(
          eq(contractTemplates.operatorId, actor.operatorId),
          eq(contractTemplates.kind, template.kind),
          ne(contractTemplates.id, templateId),
        ),
      );
    await tx
      .update(contractTemplates)
      .set({ isDefault: true })
      .where(eq(contractTemplates.id, templateId));
    await logTemplateActivity(tx, actor, templateId, ACTIVITY_ACTIONS.updated, {
      valuesBefore: { isDefault: false },
      valuesAfter: { isDefault: true },
    });
    return "changed";
  });
}

export type ArchiveTemplateResult = TemplateChangeResult | "is_default";

/** Hides a template that is no longer used; its versions and anything issued from them stay. */
export async function archiveTemplate(
  database: AnyDatabase,
  actor: ActingUser,
  templateId: string,
): Promise<ArchiveTemplateResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const template = await lockTemplate(tx, actor.operatorId, templateId);
    if (!template) {
      return "not_found";
    }
    if (template.isDefault) {
      return "is_default";
    }
    await tx
      .update(contractTemplates)
      .set({ archivedAt: new Date() })
      .where(eq(contractTemplates.id, templateId));
    await logTemplateActivity(tx, actor, templateId, ACTIVITY_ACTIONS.archived);
    return "changed";
  });
}

/** The Operator's current templates, defaults first, with their latest version number. */
export async function listTemplates(
  database: AnyDatabase,
  operatorId: string,
): Promise<TemplateSummary[]> {
  return withTenant(database, operatorId, async (tx) => {
    const templates = await tx
      .select()
      .from(contractTemplates)
      .where(
        and(eq(contractTemplates.operatorId, operatorId), isNull(contractTemplates.archivedAt)),
      )
      .orderBy(
        asc(contractTemplates.kind),
        desc(contractTemplates.isDefault),
        asc(contractTemplates.name),
      );
    const versions = await tx
      .select({
        templateId: contractTemplateVersions.templateId,
        version: contractTemplateVersions.version,
      })
      .from(contractTemplateVersions)
      .where(eq(contractTemplateVersions.operatorId, operatorId));
    return templates.map((template) => ({
      id: template.id,
      kind: template.kind,
      name: template.name,
      isDefault: template.isDefault,
      archivedAt: template.archivedAt,
      updatedAt: template.updatedAt,
      latestVersion: Math.max(
        0,
        ...versions.filter((row) => row.templateId === template.id).map((row) => row.version),
      ),
    }));
  });
}

/** One of the Operator's templates with its latest text and its versions, newest first. */
export async function loadTemplate(
  database: AnyDatabase,
  operatorId: string,
  templateId: string,
): Promise<TemplateDetail | null> {
  return withTenant(database, operatorId, async (tx) => {
    const [template] = await tx
      .select()
      .from(contractTemplates)
      .where(
        and(eq(contractTemplates.id, templateId), eq(contractTemplates.operatorId, operatorId)),
      );
    const latest = template ? await latestVersionOf(tx, operatorId, templateId) : undefined;
    if (!template || !latest) {
      return null;
    }
    const versions = await tx
      .select({
        id: contractTemplateVersions.id,
        version: contractTemplateVersions.version,
        createdAt: contractTemplateVersions.createdAt,
      })
      .from(contractTemplateVersions)
      .where(
        and(
          eq(contractTemplateVersions.operatorId, operatorId),
          eq(contractTemplateVersions.templateId, templateId),
        ),
      )
      .orderBy(desc(contractTemplateVersions.version));
    return {
      id: template.id,
      kind: template.kind,
      name: template.name,
      isDefault: template.isDefault,
      archivedAt: template.archivedAt,
      updatedAt: template.updatedAt,
      latestVersion: latest.version,
      latestVersionId: latest.id,
      content: latest.content,
      versions,
    };
  });
}

/** The template of this kind new rentals use, with its latest version, if the Operator has one. */
export async function loadDefaultTemplate(
  database: AnyDatabase,
  operatorId: string,
  kind: ContractTemplateKind,
): Promise<TemplateDetail | null> {
  const [template] = await withTenant(database, operatorId, (tx) =>
    tx
      .select({ id: contractTemplates.id })
      .from(contractTemplates)
      .where(
        and(
          eq(contractTemplates.operatorId, operatorId),
          eq(contractTemplates.kind, kind),
          eq(contractTemplates.isDefault, true),
          isNull(contractTemplates.archivedAt),
        ),
      ),
  );
  return template ? loadTemplate(database, operatorId, template.id) : null;
}
