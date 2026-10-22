import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { authDb } from "../../../lib/auth";
import { findUsableInvite } from "../../../lib/invites/find-invite";
import { AcceptInviteForm } from "./accept-invite-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage(props: InvitePageProps) {
  const { token } = await props.params;
  const invite = await findUsableInvite(authDb, token, new Date());

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <Card>
        {invite ? (
          <>
            <CardHeader>
              <CardTitle>Set up your login</CardTitle>
              <CardDescription>
                For {invite.operatorName}, as <span className="break-all">{invite.email}</span>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AcceptInviteForm token={token} email={invite.email} />
            </CardContent>
          </>
        ) : (
          <CardHeader>
            <CardTitle>This link no longer works</CardTitle>
            <CardDescription>
              It may have expired or already been used. Ask for a new invite.
            </CardDescription>
          </CardHeader>
        )}
      </Card>
    </main>
  );
}
