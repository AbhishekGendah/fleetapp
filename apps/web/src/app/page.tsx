import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { requireUser } from "../lib/require-user";
import { SignOutButton } from "./sign-out-button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TODO: replace with the dashboard and setup checklist in slice 5.
export default async function HomePage() {
  const user = await requireUser();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{user.operatorName}</CardTitle>
          <CardDescription>
            Signed in as <span className="break-all">{user.email}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">Your dashboard is coming next.</p>
          <SignOutButton />
        </CardContent>
      </Card>
    </main>
  );
}
