import { Button } from "@fleetapp/ui/button";
import Link from "next/link";
import { AuthPageLayout } from "@fleetapp/ui/auth-page-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { authDb } from "../../../lib/auth";
import { findUsableInvite } from "../../../lib/invites/find-invite";
import { SIGN_IN_PATH } from "../../../lib/paths";
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
              <AcceptInviteForm token={token} email={invite.email} />
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>This link no longer works</CardTitle>
              <CardDescription>
                It may have expired or already been used. If you have already set up your login (for
                example with Forgot password), sign in. Otherwise ask for a new invite.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href={SIGN_IN_PATH}>Sign in</Link>
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </AuthPageLayout>
  );
}
