import type { Metadata } from "next";
import { PageHeader } from "@fleetapp/ui/page-header";
import { OPERATORS_PATH } from "../../../lib/paths";
import { requireAdmin } from "../../../lib/require-admin";
import { AdminShell } from "../../admin-shell";
import { NewOperatorForm } from "./new-operator-form";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "New Operator" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewOperatorPage() {
  await requireAdmin();

  return (
    <AdminShell>
      <PageHeader backHref={OPERATORS_PATH} backLabel="Operators" title="New Operator" />
      <p className="text-muted-foreground text-sm">
        The person below gets an email with a link to set up their login. Everything else about the
        business, they fill in themselves once signed in.
      </p>
      <NewOperatorForm />
    </AdminShell>
  );
}
