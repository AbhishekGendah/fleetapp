import type { Metadata } from "next";
import { formatFileSize } from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { formatAdminDateTime } from "../../../lib/format";
import type { OperatorDetail } from "../../../lib/operators/queries";
import { INVITE_RESULT_PARAM, INVITE_RESULTS } from "../invite-result";
import { loadOperatorForPage, OperatorFrame } from "./operator-frame";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Operator" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INVITE_RESULT_MESSAGES: Record<string, { text: string; isProblem: boolean }> = {
  [INVITE_RESULTS.sent]: { text: "Invite sent.", isProblem: false },
  [INVITE_RESULTS.notSent]: {
    text: "The invite email could not be sent. Try Resend invite.",
    isProblem: true,
  },
};

interface OperatorPageProps {
  params: Promise<{ operatorId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** A business's page, Details tab: who they are and how far through setup (Abhi's A5, A7). */
export default async function OperatorPage(props: OperatorPageProps) {
  const operator = await loadOperatorForPage((await props.params).operatorId);
  const inviteResult = (await props.searchParams)[INVITE_RESULT_PARAM];
  const resultMessage =
    typeof inviteResult === "string" ? INVITE_RESULT_MESSAGES[inviteResult] : undefined;

  return (
    <OperatorFrame
      operator={operator}
      current="details"
      notice={
        resultMessage ? (
          <p
            className={resultMessage.isProblem ? "text-destructive text-sm" : "text-sm"}
            role="status"
          >
            {resultMessage.text}
          </p>
        ) : null
      }
    >
      <DetailsCard operator={operator} />
      <SetupCard operator={operator} />
    </OperatorFrame>
  );
}

function DetailsCard({ operator }: { operator: OperatorDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
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

/** A yes/no line of setup: done in the good colour, still to do in amber. */
function SetupLine(props: { label: string; isDone: boolean; doneText: string; todoText: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd>
        <Badge tone={props.isDone ? "good" : "attention"}>
          {props.isDone ? props.doneText : props.todoText}
        </Badge>
      </dd>
    </>
  );
}

/** How far the business is through its own setup checklist, and how it is using the app (A7). */
function SetupCard({ operator }: { operator: OperatorDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Setup and use</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid items-center gap-2 text-sm sm:grid-cols-[10rem_1fr]">
          <SetupLine
            label="Business details"
            isDone={operator.hasBusinessDetails}
            doneText="Entered"
            todoText="Not entered yet"
          />
          <SetupLine
            label="Stripe payments"
            isDone={operator.isStripeReady}
            doneText="Ready"
            todoText="Not ready yet"
          />
          <SetupLine
            label="Stripe payouts"
            isDone={operator.isStripePayoutReady}
            doneText="Ready"
            todoText="Not ready yet"
          />
          <dt className="text-muted-foreground">Direct debit (BECS)</dt>
          <dd>{operator.becsStatus ?? "Not asked for yet"}</dd>
          <dt className="text-muted-foreground">Last sign-in</dt>
          <dd>
            {operator.lastSignedInAt ? formatAdminDateTime(operator.lastSignedInAt) : "Never"}
          </dd>
          <dt className="text-muted-foreground">Storage used</dt>
          <dd>{formatFileSize(operator.storageUsedBytes)}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}
