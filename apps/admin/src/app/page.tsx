import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { requireAdmin } from "../lib/require-admin";
import { SignOutButton } from "./sign-out-button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const admin = await requireAdmin();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>AGS Admin</CardTitle>
          <CardDescription>Signed in as {admin.email}</CardDescription>
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
