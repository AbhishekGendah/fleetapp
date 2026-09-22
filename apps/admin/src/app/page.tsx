import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "../lib/auth";
import { SignOutButton } from "./sign-out-button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });

  // Authorisation happens here, in server code, not in routing (rule 4).
  if (!session) {
    redirect("/sign-in");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>AGS Admin</CardTitle>
          <CardDescription>Signed in as {session.user.email}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            Creating and managing Operators lands in the next slice.
          </p>
          <SignOutButton />
        </CardContent>
      </Card>
    </main>
  );
}
