import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { formatAdminDateTime } from "../../../../lib/format";
import { INVITE_STATUS_LABELS } from "../../../../lib/operators/status-labels";
import { loadOperatorForPage, OperatorFrame } from "../operator-frame";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Operator invites" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A business's page, Invites tab: every invite sent, newest first (Abhi's A5). */
export default async function OperatorInvitesPage(props: {
  params: Promise<{ operatorId: string }>;
}) {
  const operator = await loadOperatorForPage((await props.params).operatorId);
  return (
    <OperatorFrame operator={operator} current="invites">
      <Card>
        <CardHeader>
          <CardTitle>Invites</CardTitle>
        </CardHeader>
        <CardContent>
          {operator.invites.length === 0 ? (
            <p className="text-sm">No invites yet.</p>
          ) : (
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
          )}
        </CardContent>
      </Card>
    </OperatorFrame>
  );
}
