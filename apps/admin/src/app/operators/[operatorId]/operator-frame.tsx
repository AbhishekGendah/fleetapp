import { operatorDisplayName } from "@fleetapp/core";
import { PageHeader } from "@fleetapp/ui/page-header";
import { TabLinks } from "@fleetapp/ui/tab-links";
import { notFound } from "next/navigation";
import { z } from "zod";

import { appDb } from "../../../lib/app-db";
import { getOperatorDetail, type OperatorDetail } from "../../../lib/operators/queries";
import {
  OPERATORS_PATH,
  operatorInvitesPath,
  operatorLogPath,
  operatorPath,
} from "../../../lib/paths";
import { requireAdmin } from "../../../lib/require-admin";
import { AdminShell } from "../../admin-shell";
import { OperatorStatusBadge } from "../../status-badge";
import { OperatorActions } from "./operator-actions";

export type OperatorTab = "details" | "invites" | "log";

const TABS: readonly { key: OperatorTab; label: string; href: (operatorId: string) => string }[] = [
  { key: "details", label: "Details", href: operatorPath },
  { key: "invites", label: "Invites", href: operatorInvitesPath },
  { key: "log", label: "Log", href: operatorLogPath },
];

/** An Admin can resend unless the invite is already accepted or the Operator is suspended. */
function canResendInvite(operator: OperatorDetail): boolean {
  return operator.status !== "active" && operator.status !== "suspended";
}

/**
 * Loads the business a page is about, for an Admin only, or shows Not found.
 * The ID is checked before it reaches the database, which would reject a
 * malformed one with an error rather than finding nothing.
 */
export async function loadOperatorForPage(operatorId: string): Promise<OperatorDetail> {
  await requireAdmin();
  if (!z.uuid().safeParse(operatorId).success) {
    notFound();
  }
  const operator = await getOperatorDetail(appDb, operatorId, new Date());
  if (!operator) {
    notFound();
  }
  return operator;
}

/**
 * What every tab of a business's page shares (Abhi's A5): its name and
 * status, Suspend or Reactivate, and the tabs, each with its own address.
 */
export function OperatorFrame(props: {
  operator: OperatorDetail;
  current: OperatorTab;
  notice?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { operator } = props;
  return (
    <AdminShell>
      <div className="flex flex-col gap-2">
        <PageHeader
          backHref={OPERATORS_PATH}
          backLabel="Operators"
          title={operatorDisplayName(operator)}
          aside={<OperatorStatusBadge status={operator.status} />}
        />
        {props.notice}
      </div>
      <OperatorActions
        operatorId={operator.id}
        isSuspended={operator.suspendedAt !== null}
        canResendInvite={canResendInvite(operator)}
      />
      <TabLinks
        label="This business"
        tabs={TABS.map((tab) => ({
          href: tab.href(operator.id),
          label: tab.label,
          isCurrent: tab.key === props.current,
        }))}
      />
      {props.children}
    </AdminShell>
  );
}
