import {
  expiryStatus,
  formatCalendarDate,
  formatCents,
  formatPremium,
  INSURANCE_COVER_TYPE_LABELS,
  regoTermLabel,
} from "@fleetapp/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import Link from "next/link";

import { ActionButton } from "@fleetapp/ui/action-button";
import { ChooseAndApply } from "@fleetapp/ui/choose-and-apply";
import { listAttachments, type Attachment } from "../../../lib/files/attachments";
import { Attachments } from "../attachments";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { ChevronRight, Plus, Unlink } from "lucide-react";
import { appDb } from "../../../lib/app-db";
import { carPath, INSURANCE_PATH, policyPath } from "../../../lib/paths";
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
import { RegoCard } from "./rego-card";
import {
  addPolicyForCarAction,
  addRegoAction,
  joinPolicyAction,
  leavePolicyAction,
  removeRegoAction,
} from "./paperwork-actions";

function PolicyLine(props: {
  vehicle: VehicleDetail;
  policy: Policy;
  expiry: ExpiryContext;
  attachments: readonly Attachment[];
}) {
  const { vehicle, policy, expiry } = props;
  const isEditable = vehicle.archivedAt === null;
  return (
    <RecordItem
      title={
        <Link
          href={policyPath(policy.id)}
          className="text-teal inline-flex min-h-11 items-center gap-1 hover:underline"
        >
          {policy.insurer} · {policy.policyNumber}
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      }
      amount={formatPremium(policy.costCents, policy.paymentFrequency)}
      details={
        <>
          <p>{INSURANCE_COVER_TYPE_LABELS[policy.coverType]}</p>
          <p>
            Ends{" "}
            <ExpiryDate
              date={policy.endsOn}
              status={expiryStatus(policy.endsOn, expiry.today, expiry.warningDays)}
            />
          </p>
        </>
      }
      actions={
        isEditable ? (
          <ActionButton
            action={leavePolicyAction.bind(null, vehicle.id, policy.id)}
            label="Take off this policy"
            pendingLabel="Taking off…"
            variant="danger"
            icon={<Unlink aria-hidden />}
          />
        ) : undefined
      }
    >
      <Attachments
        target={{ kind: "policy", id: policy.id }}
        attachments={props.attachments}
        isEditable={isEditable}
        pagePath={carPath(vehicle.id)}
      />
    </RecordItem>
  );
}

function InsuranceCard(props: {
  vehicle: VehicleDetail;
  policies: readonly Policy[];
  policiesToJoin: readonly Policy[];
  expiry: ExpiryContext;
  isGstRegistered: boolean;
  attachments: readonly Attachment[];
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
          <RecordList label="Policies">
            {policies.map((policy) => (
              <PolicyLine
                key={policy.id}
                vehicle={vehicle}
                policy={policy}
                expiry={expiry}
                attachments={props.attachments}
              />
            ))}
          </RecordList>
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
          <FormDialog
            triggerLabel="Add insurance"
            triggerIcon={<Plus aria-hidden />}
            isMainAction
            title="Add insurance for this car"
          >
            <PolicyForm
              initialValues={emptyPolicyForm()}
              action={addPolicyForCarAction.bind(null, vehicle.id)}
              submitLabel="Add insurance"
              isGstRegistered={props.isGstRegistered}
              shouldClearOnSave
            />
          </FormDialog>
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
  const attachments = await listAttachments(appDb, user.operatorId, {
    vehicleId: vehicle.id,
    policyIds: paperwork.policies.map((policy) => policy.id),
  });
  return (
    <>
      <RegoCard
        vehicle={vehicle}
        registrations={paperwork.registrations}
        expiry={expiry}
        isGstRegistered={user.isGstRegistered}
        attachments={attachments}
      />
      <InsuranceCard
        vehicle={vehicle}
        policies={paperwork.policies}
        policiesToJoin={policiesToJoin}
        expiry={expiry}
        isGstRegistered={user.isGstRegistered}
        attachments={attachments}
      />
    </>
  );
}
