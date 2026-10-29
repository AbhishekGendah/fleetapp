import { AuthPageLayout } from "@fleetapp/ui/auth-page-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { authDb } from "../../../lib/auth";
import { findUsableInvite } from "../../../lib/invites/find-invite";
import { AcceptInviteForm } from "./accept-invite-form";
import { MINIMUM_PASSWORD_LENGTH } from "@fleetapp/auth/login-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage(props: InvitePageProps) {
  const { token } = await props.params;
  const invite = await findUsableInvite(authDb, token, new Date());

  return (
    <AuthPageLayout>
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
              <AcceptInviteForm
                token={token}
                email={invite.email}
                minimumLength={MINIMUM_PASSWORD_LENGTH}
              />
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
    </AuthPageLayout>
  );
}
