import {
  expiryStatus,
  formatCalendarDate,
  formatCents,
  INSURANCE_COVER_TYPE_LABELS,
} from "@fleetapp/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import Link from "next/link";

import { ActionButton } from "@fleetapp/ui/action-button";
import { ChooseAndApply } from "@fleetapp/ui/choose-and-apply";
import { appDb } from "../../../lib/app-db";
import { INSURANCE_PATH, policyPath } from "../../../lib/paths";
import type { SignedInUser } from "../../../lib/require-user";
import type { ExpiryContext } from "../../../lib/vehicles/expiry-columns";
import { loadExpiryContext } from "../../../lib/vehicles/expiry-context";
import { emptyPolicyForm, emptyRegoForm } from "../../../lib/vehicles/paperwork-input";
import {
  listPoliciesToJoin,
  loadVehiclePaperwork,
  type Policy,
  type Registration,
} from "../../../lib/vehicles/paperwork-queries";
import type { VehicleDetail } from "../../../lib/vehicles/vehicle-queries";
import { ExpiryDate } from "../expiry-date";
import { PolicyForm } from "../policy-form";
import { RegoForm } from "../rego-form";
import {
  addPolicyForCarAction,
  addRegoAction,
  joinPolicyAction,
  leavePolicyAction,
  removeRegoAction,
} from "./paperwork-actions";

function RegoCard(props: {
  vehicle: VehicleDetail;
  registrations: readonly Registration[];
  expiry: ExpiryContext;
  isGstRegistered: boolean;
}) {
  const { vehicle, registrations, expiry } = props;
  const isEditable = vehicle.archivedAt === null;
  const current = registrations[0] ?? null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rego</CardTitle>
        <CardDescription>
          Current rego expires:{" "}
          <ExpiryDate
            date={current?.expiresOn ?? null}
            status={expiryStatus(current?.expiresOn ?? null, expiry.today, expiry.warningDays)}
          />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {registrations.length === 0 ? null : (
          <ul className="flex flex-col divide-y">
            {registrations.map((registration) => (
              <li
                key={registration.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {registration.state}, {registration.termMonths} months, to{" "}
                    {formatCalendarDate(registration.expiresOn)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {formatCents(registration.costCents)}
                    {registration.gstCents > 0
                      ? ` incl. ${formatCents(registration.gstCents)} GST`
                      : ""}
                    {registration.paidOn
                      ? ` · paid ${formatCalendarDate(registration.paidOn)}`
                      : ""}
                  </p>
                </div>
                {isEditable ? (
                  <ActionButton
                    action={removeRegoAction.bind(null, vehicle.id, registration.id)}
                    label="Remove"
                    pendingLabel="Removing…"
                    variant="ghost"
                    size="sm"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {isEditable ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-primary text-base font-semibold">Add a rego renewal</h3>
            <RegoForm
              initialValues={{ ...emptyRegoForm(), state: current?.state ?? vehicle.regoState }}
              action={addRegoAction.bind(null, vehicle.id)}
              isGstRegistered={props.isGstRegistered}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PolicyLine(props: { vehicle: VehicleDetail; policy: Policy; expiry: ExpiryContext }) {
  const { vehicle, policy, expiry } = props;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
      <div>
        <Link href={policyPath(policy.id)} className="font-medium hover:underline">
          {policy.insurer} · {policy.policyNumber}
        </Link>
        <p className="text-muted-foreground text-xs">
          {INSURANCE_COVER_TYPE_LABELS[policy.coverType]}
        </p>
        <p className="text-xs">
          Ends{" "}
          <ExpiryDate
            date={policy.endsOn}
            status={expiryStatus(policy.endsOn, expiry.today, expiry.warningDays)}
          />
        </p>
      </div>
      {vehicle.archivedAt === null ? (
        <ActionButton
          action={leavePolicyAction.bind(null, vehicle.id, policy.id)}
          label="Take off this policy"
          pendingLabel="Taking off…"
          variant="ghost"
          size="sm"
        />
      ) : null}
    </li>
  );
}

function InsuranceCard(props: {
  vehicle: VehicleDetail;
  policies: readonly Policy[];
  policiesToJoin: readonly Policy[];
  expiry: ExpiryContext;
  isGstRegistered: boolean;
}) {
  const { vehicle, policies, policiesToJoin, expiry } = props;
  const isEditable = vehicle.archivedAt === null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Insurance</CardTitle>
        <CardDescription>
          {policies.length === 0 ? "Not on any policy." : "The policies this car is on now."}{" "}
          <Link href={INSURANCE_PATH} className="text-teal font-semibold hover:underline">
            All policies
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {policies.length === 0 ? null : (
          <ul className="flex flex-col divide-y">
            {policies.map((policy) => (
              <PolicyLine key={policy.id} vehicle={vehicle} policy={policy} expiry={expiry} />
            ))}
          </ul>
        )}
        {isEditable && policiesToJoin.length > 0 ? (
          <ChooseAndApply
            label="Put on an existing policy (e.g. a fleet policy)"
            options={policiesToJoin.map((policy) => ({
              value: policy.id,
              label: `${policy.insurer} · ${policy.policyNumber} (to ${formatCalendarDate(policy.endsOn)})`,
            }))}
            buttonLabel="Add to policy"
            action={joinPolicyAction.bind(null, vehicle.id)}
          />
        ) : null}
        {isEditable ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-primary text-base font-semibold">Add insurance for this car</h3>
            <PolicyForm
              initialValues={emptyPolicyForm()}
              action={addPolicyForCarAction.bind(null, vehicle.id)}
              submitLabel="Add insurance"
              isGstRegistered={props.isGstRegistered}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** A car's rego renewals and insurance, with what is due soon or expired. */
export async function PaperworkTab({
  vehicle,
  user,
}: {
  vehicle: VehicleDetail;
  user: SignedInUser;
}) {
  const expiry = await loadExpiryContext(user);
  const [paperwork, policiesToJoin] = await Promise.all([
    loadVehiclePaperwork(appDb, user.operatorId, vehicle.id),
    listPoliciesToJoin(appDb, user.operatorId, vehicle.id, expiry.today),
  ]);
  return (
    <>
      <RegoCard
        vehicle={vehicle}
        registrations={paperwork.registrations}
        expiry={expiry}
        isGstRegistered={user.isGstRegistered}
      />
      <InsuranceCard
        vehicle={vehicle}
        policies={paperwork.policies}
        policiesToJoin={policiesToJoin}
        expiry={expiry}
        isGstRegistered={user.isGstRegistered}
      />
    </>
  );
}
