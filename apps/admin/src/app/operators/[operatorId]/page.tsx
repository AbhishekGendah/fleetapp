import { operatorDisplayName } from "@fleetapp/core";
import { describeActivity } from "@fleetapp/db/activity";
import { Card, CardContent, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { notFound } from "next/navigation";
import { z } from "zod";

import { appDb } from "../../../lib/app-db";
import { formatAdminDateTime } from "../../../lib/format";
import { getOperatorDetail, type OperatorDetail } from "../../../lib/operators/queries";
import { INVITE_STATUS_LABELS } from "../../../lib/operators/status-labels";
import { requireAdmin } from "../../../lib/require-admin";
import { AdminShell } from "../../admin-shell";
import { OperatorStatusBadge } from "../../status-badge";
import { INVITE_RESULT_PARAM, INVITE_RESULTS } from "../invite-result";
import { OperatorActions } from "./operator-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INVITE_RESULT_MESSAGES: Record<string, { text: string; isProblem: boolean }> = {
  [INVITE_RESULTS.sent]: { text: "Invite sent.", isProblem: false },
  [INVITE_RESULTS.notSent]: {
    text: "The invite email could not be sent. Try Resend invite.",
    isProblem: true,
  },
};

/** An Admin can resend unless the invite is already accepted or the Operator is suspended. */
function canResendInvite(operator: OperatorDetail): boolean {
  return operator.status !== "active" && operator.status !== "suspended";
}

interface OperatorPageProps {
  params: Promise<{ operatorId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OperatorPage(props: OperatorPageProps) {
  await requireAdmin();

  const { operatorId } = await props.params;
  // Checked before it reaches the database, which would reject a malformed ID
  // with an error rather than finding nothing.
  if (!z.uuid().safeParse(operatorId).success) {
    notFound();
  }

  const operator = await getOperatorDetail(appDb, operatorId, new Date());
  if (!operator) {
    notFound();
  }

  const inviteResult = (await props.searchParams)[INVITE_RESULT_PARAM];
  const resultMessage =
    typeof inviteResult === "string" ? INVITE_RESULT_MESSAGES[inviteResult] : undefined;

  return (
    <AdminShell>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{operatorDisplayName(operator)}</h1>
          <OperatorStatusBadge status={operator.status} />
        </div>
        {resultMessage ? (
          <p
            className={resultMessage.isProblem ? "text-destructive text-sm" : "text-sm"}
            role="status"
          >
            {resultMessage.text}
          </p>
        ) : null}
      </div>

      <OperatorActions
        operatorId={operator.id}
        isSuspended={operator.suspendedAt !== null}
        canResendInvite={canResendInvite(operator)}
      />

      <DetailsCard operator={operator} />
      <InvitesCard operator={operator} />
      <HistoryCard operator={operator} />
    </AdminShell>
  );
}

function DetailsCard({ operator }: { operator: OperatorDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Details</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">Legal name</dt>
          <dd>{operator.legalName}</dd>
          <dt className="text-muted-foreground">Trading name</dt>
          <dd>{operator.tradingName ?? "None"}</dd>
          <dt className="text-muted-foreground">User</dt>
          <dd className="break-all">
            {operator.user ? `${operator.user.fullName} (${operator.user.email})` : "None"}
          </dd>
          <dt className="text-muted-foreground">Created</dt>
          <dd>{formatAdminDateTime(operator.createdAt)}</dd>
          {operator.suspendedAt ? (
            <>
              <dt className="text-muted-foreground">Suspended</dt>
              <dd>{formatAdminDateTime(operator.suspendedAt)}</dd>
            </>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}

function InvitesCard({ operator }: { operator: OperatorDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invites</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3 text-sm">
          {operator.invites.map((invite) => (
            <li key={invite.id} className="flex flex-col">
              <span className="font-medium">{INVITE_STATUS_LABELS[invite.status]}</span>
              <span className="text-muted-foreground">
                Created {formatAdminDateTime(invite.createdAt)} · expires{" "}
                {formatAdminDateTime(invite.expiresAt)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function HistoryCard({ operator }: { operator: OperatorDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Log</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          {operator.history.map((entry) => (
            <li key={entry.id} className="flex flex-col sm:flex-row sm:gap-2">
              <span className="text-muted-foreground">{formatAdminDateTime(entry.occurredAt)}</span>
              <span>
                {describeActivity(entry.entityType, entry.action)} by {entry.actorType}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
