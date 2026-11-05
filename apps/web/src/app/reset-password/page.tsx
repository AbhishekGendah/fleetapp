import type { Metadata } from "next";
import { AuthPageLayout } from "@fleetapp/ui/auth-page-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import Link from "next/link";

import { FORGOT_PASSWORD_PATH } from "../../lib/paths";
import { ResetPasswordForm } from "./reset-password-form";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Reset password" };

export const dynamic = "force-dynamic";

interface ResetPasswordPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Whether the link still works is only known when the new password is
 * submitted: checking it here would mean looking it up twice.
 */
export default async function ResetPasswordPage(props: ResetPasswordPageProps) {
  const { token } = await props.searchParams;
  const completeToken = typeof token === "string" && token ? token : null;

  return (
    <AuthPageLayout>
      <Card>
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
          {completeToken ? null : (
            <CardDescription>This link is not complete. Ask for a new one.</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {completeToken ? (
            <ResetPasswordForm token={completeToken} />
          ) : (
            <Link
              href={FORGOT_PASSWORD_PATH}
              className="inline-flex min-h-11 items-center text-sm hover:underline"
            >
              Send me a new link
            </Link>
          )}
        </CardContent>
      </Card>
    </AuthPageLayout>
  );
}
