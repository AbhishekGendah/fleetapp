import { Card, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>AGS Admin</CardTitle>
          <CardDescription>Scaffold placeholder — features land in later tasks.</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
