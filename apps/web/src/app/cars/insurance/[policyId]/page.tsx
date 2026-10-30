import { expiryStatus, formatPremium, INSURANCE_COVER_TYPE_LABELS, isRecordId } from "@fleetapp/core";
import { ACTIVITY_ENTITY_TYPES } from "@fleetapp/db/schema";
import { Badge } from "@fleetapp/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton } from "@fleetapp/ui/action-button";
import { ChooseAndApply } from "@fleetapp/ui/choose-and-apply";
import { appDb } from "../../../../lib/app-db";
import { carPath, INSURANCE_PATH } from "../../../../lib/paths";
import { requireUser } from "../../../../lib/require-user";
import { loadExpiryContext } from "../../../../lib/vehicles/expiry-context";
import { policyFormValues } from "../../../../lib/vehicles/paperwork-input";
import { loadPolicy, type PolicyDetail } from "../../../../lib/vehicles/paperwork-queries";
import { AppShell } from "../../../app-shell";
import { CarHistoryCard } from "../../car-history-card";
import { ExpiryDate } from "../../expiry-date";
import { PolicyForm } from "../../policy-form";
import {
  addCarToPolicyAction,
  archivePolicyAction,
  removeCarFromPolicyAction,
  updatePolicyAction,
} from "../actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function carLabel(car: PolicyDetail["cars"][number]): string {
  return `${car.rego} (${car.regoState}) · ${car.make} ${car.model}`;
}

function CoveredCarsCard({ detail }: { detail: PolicyDetail }) {
  const { policy, cars, otherCars } = detail;
  const isEditable = policy.archivedAt === null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cars it covers</CardTitle>
        <CardDescription>
          {cars.length === 0
            ? "No cars yet."
            : `${cars.length} ${cars.length === 1 ? "car" : "cars"}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {cars.length === 0 ? null : (
          <ul className="flex flex-col divide-y">
            {cars.map((car) => (
              <li
                key={car.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <Link href={carPath(car.id)} className="font-medium hover:underline">
                  {carLabel(car)}
                </Link>
                {isEditable ? (
                  <ActionButton
                    action={removeCarFromPolicyAction.bind(null, policy.id, car.id)}
                    label="Take off"
                    pendingLabel="Taking off…"
                    variant="ghost"
                    size="sm"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {isEditable && otherCars.length > 0 ? (
          <ChooseAndApply
            label="Add a car to this policy"
            options={otherCars.map((car) => ({ value: car.id, label: carLabel(car) }))}
            buttonLabel="Add car"
            action={addCarToPolicyAction.bind(null, policy.id)}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

/** One policy: its details (editable), the cars it covers, and its history. */
export default async function PolicyPage(props: { params: Promise<{ policyId: string }> }) {
  const user = await requireUser();
  const { policyId } = await props.params;
  const detail = isRecordId(policyId) ? await loadPolicy(appDb, user.operatorId, policyId) : null;
  if (!detail) {
    notFound();
  }
  const { policy } = detail;
  const expiry = await loadExpiryContext(user);
  const isArchived = policy.archivedAt !== null;

  return (
    <AppShell user={user}>
      <Link
        href={INSURANCE_PATH}
        className="text-teal inline-flex min-h-11 items-center text-sm font-semibold"
      >
        ← All policies
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-primary text-2xl font-extrabold">{policy.insurer}</h1>
        {isArchived ? <Badge>Archived</Badge> : null}
      </div>
      <p className="text-muted-foreground -mt-2 flex flex-wrap items-center gap-2 text-sm">
        {policy.policyNumber} · {INSURANCE_COVER_TYPE_LABELS[policy.coverType]} ·{" "}
        {formatPremium(policy.costCents, policy.paymentFrequency)} · ends{" "}
        <ExpiryDate
          date={policy.endsOn}
          status={expiryStatus(policy.endsOn, expiry.today, expiry.warningDays)}
        />
      </p>

      <CoveredCarsCard detail={detail} />

      {isArchived ? null : (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <PolicyForm
              initialValues={policyFormValues(policy)}
              action={updatePolicyAction.bind(null, policy.id)}
              submitLabel="Save changes"
              isGstRegistered={user.isGstRegistered}
            />
          </CardContent>
        </Card>
      )}

      {isArchived ? null : (
        <Card>
          <CardHeader>
            <CardTitle>Archive</CardTitle>
            <CardDescription>
              Hides the policy, e.g. once it has ended and been renewed as a new one. Nothing is
              deleted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ActionButton
              action={archivePolicyAction.bind(null, policy.id)}
              label="Archive this policy"
              pendingLabel="Archiving…"
            />
          </CardContent>
        </Card>
      )}

      <CarHistoryCard
        user={user}
        subjects={[{ entityType: ACTIVITY_ENTITY_TYPES.insurancePolicy, entityIds: [policy.id] }]}
      />
    </AppShell>
  );
}
