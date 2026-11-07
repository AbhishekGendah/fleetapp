import type { Metadata } from "next";
import {
  CLAIM_STATUS_LABELS,
  DAMAGE_STATUS_LABELS,
  formatCalendarDate,
  centsForEditing,
  formatCents,
  isRecordId,
  todayInTimeZone,
} from "@fleetapp/core";
import { ACTIVITY_ENTITY_TYPES } from "@fleetapp/db/schema";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { CarOutline } from "@fleetapp/ui/car-outline";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { PageHeader } from "@fleetapp/ui/page-header";
import { Archive, Check, Pencil, Plus, X } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DetailLines, type DetailLine } from "../../../../../components/detail-lines";
import { HistoryCard } from "../../../../../components/history-card";
import { appDb } from "../../../../../lib/app-db";
import { claimFormValues } from "../../../../../lib/damage/damage-input";
import { describeDamageValue, damageFieldLabel } from "../../../../../lib/damage/damage-labels";
import {
  listClaimPolicyChoices,
  loadClaimDefaults,
  loadDamageDetail,
  type DamageDetail,
} from "../../../../../lib/damage/damage-queries";
import { listChargeTypes } from "../../../../../lib/ledger/charge-types";
import { chargeStart } from "../../../../../lib/ledger/ledger-input";
import { loadDamageCharges } from "../../../../../lib/ledger/ledger-queries";
import { carPath, rentalPath } from "../../../../../lib/paths";
import { TAB_PARAM } from "../../../../../lib/record-tabs";
import { requireUser, type SignedInUser } from "../../../../../lib/require-user";
import { appFileStorage } from "../../../../../lib/storage/app-file-storage";
import { AppShell } from "../../../../app-shell";
import { CarPhotoGrid } from "../../car-photo-grid";
import {
  archiveDamageAction,
  changeDamageStatusAction,
  confirmDamageRentalAction,
  saveClaimAction,
} from "../../damage-actions";
import { PhotoUploads } from "../../photo-uploads";
import { ChargeForm } from "../../../../rentals/[rentalId]/charge-form";
import { addChargeAction } from "../../../../rentals/[rentalId]/money-actions";
import { LedgerLineList } from "../../../../rentals/ledger-line-list";
import { ClaimForm } from "./claim-form";
import { DamageStatusForm } from "./damage-status-form";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Damage" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ids = { vehicleId: string; damageId: string };

function WhatCard({ detail }: { detail: DamageDetail }) {
  const { record } = detail;
  const lines: DetailLine[] = [
    ["Found on", formatCalendarDate(record.foundOn)],
    ["Status", DAMAGE_STATUS_LABELS[record.status]],
    ...(record.statusNote ? [["Note", record.statusNote] as const] : []),
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{record.description}</CardTitle>
        <CardDescription>
          {record.damageMarkId
            ? "Marked as new damage at the return."
            : "Recorded away from a checklist."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <DetailLines lines={lines} />
        {record.x === null || record.y === null ? null : (
          <CarOutline
            label={`Car outline showing where: ${record.description}`}
            marks={[
              { id: record.id, x: record.x, y: record.y, label: `Damage 1: ${record.description}` },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Who had the car: from the return it was found at, or confirmed by the
 * Operator from who had it that day (rule 15). Only ever a record, never a charge.
 */
function WhoHadItCard({ detail, ids }: { detail: DamageDetail; ids: Ids }) {
  const { record, suggestedHolder } = detail;
  const isFromReturn = record.damageMarkId !== null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Who had the car</CardTitle>
        <CardDescription>
          {isFromReturn
            ? "Found when the car came back from this rental."
            : "Worked out from who had the car on the day it was found. Check it before saving."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {record.rentalId && detail.renterFullName ? (
          <p>
            <Link
              href={rentalPath(record.rentalId)}
              className="text-teal hover:text-primary font-semibold"
            >
              {detail.renterFullName}
            </Link>
          </p>
        ) : suggestedHolder ? (
          <p>{suggestedHolder.renterFullName} had the car that day.</p>
        ) : (
          <p className="text-muted-foreground">Nobody had the car that day.</p>
        )}
        {isFromReturn ? null : (
          <div className="flex flex-wrap gap-2">
            {suggestedHolder ? (
              <ActionButton
                action={confirmDamageRentalAction.bind(
                  null,
                  ids.vehicleId,
                  ids.damageId,
                  suggestedHolder.rentalId,
                )}
                label={`Yes, it was ${suggestedHolder.renterFullName}`}
                pendingLabel="Saving…"
                icon={<Check aria-hidden />}
              />
            ) : null}
            {record.rentalId ? (
              <ActionButton
                action={confirmDamageRentalAction.bind(null, ids.vehicleId, ids.damageId, null)}
                label="Not them: clear"
                pendingLabel="Clearing…"
                variant="outline"
                icon={<X aria-hidden />}
              />
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PhotosCard({ detail, ids }: { detail: DamageDetail; ids: Ids }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Photos</CardTitle>
        <CardDescription>
          {detail.record.damageMarkId
            ? "The return's photo of it, and any you add. They are on the car's Photos tab too."
            : "They are on the car's Photos tab too."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <PhotoUploads vehicleId={ids.vehicleId} damageId={ids.damageId} />
        {detail.isEvidenceHeld ? (
          <p className="text-muted-foreground text-sm">
            These photos back a charge to the Renter or an insurance claim, so they can&apos;t be
            removed while that is open.
          </p>
        ) : null}
        <CarPhotoGrid
          vehicleId={ids.vehicleId}
          photos={detail.photos}
          isEditable={!detail.isEvidenceHeld}
        />
      </CardContent>
    </Card>
  );
}

function claimLines(detail: DamageDetail): DetailLine[] {
  const { claim, claimPolicy } = detail;
  if (!claim) {
    return [];
  }
  const money = (cents: number | null) => (cents === null ? "Not entered" : formatCents(cents));
  const day = (date: string | null) => (date === null ? "Not yet" : formatCalendarDate(date));
  return [
    [
      "Insurer",
      claimPolicy ? `${claim.insurer} (policy ${claimPolicy.policyNumber})` : claim.insurer,
    ],
    ["Status", CLAIM_STATUS_LABELS[claim.status]],
    ["Claim number", claim.claimNumber ?? "Not lodged"],
    ["Excess", money(claim.excessCents)],
    ["Lodged on", day(claim.lodgedOn)],
    ["Settled on", day(claim.settledOn)],
    ["Paid out", money(claim.payoutCents)],
    ...(claim.notes ? [["Notes", claim.notes] as const] : []),
  ];
}

/** The insurance claim, if one is made. Nothing is charged to the Renter here (Phase 4). */
async function ClaimCard({
  detail,
  ids,
  user,
}: {
  detail: DamageDetail;
  ids: Ids;
  user: SignedInUser;
}) {
  const [policies, defaults] = await Promise.all([
    listClaimPolicyChoices(appDb, user.operatorId, ids.vehicleId),
    detail.claim
      ? Promise.resolve(null)
      : loadClaimDefaults(appDb, user.operatorId, {
          vehicleId: ids.vehicleId,
          foundOn: detail.record.foundOn,
          timeZone: user.operatorTimezone,
        }),
  ]);
  const hasClaim = detail.claim !== null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Insurance claim</CardTitle>
        <CardDescription>
          {hasClaim
            ? "Keep it up to date as the insurer gets back to you."
            : "If you claim for this, keep track of it here. The excess comes from the car's policy that day."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {hasClaim ? <DetailLines lines={claimLines(detail)} /> : null}
        <FormDialog
          triggerLabel={hasClaim ? "Update claim" : "Add a claim"}
          triggerIcon={hasClaim ? <Pencil aria-hidden /> : <Plus aria-hidden />}
          isMainAction={!hasClaim}
          title={hasClaim ? "Update the claim" : "Add a claim"}
        >
          <ClaimForm
            action={saveClaimAction.bind(null, ids.vehicleId, ids.damageId)}
            initialValues={claimFormValues(detail.claim, defaults)}
            policies={policies}
            submitLabel="Save claim"
          />
        </FormDialog>
      </CardContent>
    </Card>
  );
}

/**
 * Recovering the cost from the Renter who had the car: a charge on their
 * rental's ledger, linked to this damage, its description telling them what
 * it is for (consumer law). Only once the rental is confirmed.
 */
async function ChargeRenterCard({
  detail,
  ids,
  user,
}: {
  detail: DamageDetail;
  ids: Ids;
  user: SignedInUser;
}) {
  const rentalId = detail.record.rentalId;
  if (!rentalId) {
    return null;
  }
  const [charges, chargeTypes] = await Promise.all([
    loadDamageCharges(appDb, user.operatorId, ids.damageId),
    listChargeTypes(appDb, user.operatorId),
  ]);
  const usable = chargeTypes.filter((type) => !type.isArchived);
  const excessCents = detail.claim?.excessCents ?? null;
  const presetType = usable.find((type) => type.builtIn === (excessCents ? "excess" : "damage"));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Charge the Renter</CardTitle>
        <CardDescription>
          Adds a charge to {detail.renterFullName ?? "the Renter"}&apos;s rental, saying what it is
          for. Only charge what the rental contract allows.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {charges.lines.length > 0 ? (
          <LedgerLineList ledger={charges} label="Charges for this damage" />
        ) : null}
        <FormDialog
          triggerLabel="Charge the Renter"
          title="Charge the Renter for this damage"
          triggerIcon={<Plus aria-hidden />}
          isMainAction={charges.lines.length === 0}
        >
          <ChargeForm
            action={addChargeAction.bind(null, rentalId, {
              recordId: ids.damageId,
              vehicleId: ids.vehicleId,
            })}
            chargeTypes={usable}
            initialValues={chargeStart(
              {
                chargeTypeId: presetType?.id ?? "",
                amountCents: excessCents ? centsForEditing(excessCents) : "",
                description: `Damage to ${detail.car.rego}: ${detail.record.description}`,
              },
              todayInTimeZone(new Date(), user.operatorTimezone),
            )}
          />
        </FormDialog>
      </CardContent>
    </Card>
  );
}

function StatusCard({ detail, ids }: { detail: DamageDetail; ids: Ids }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Status</CardTitle>
      </CardHeader>
      <CardContent>
        <DamageStatusForm
          action={changeDamageStatusAction.bind(null, ids.vehicleId, ids.damageId)}
          initialValues={{
            status: detail.record.status,
            statusNote: detail.record.statusNote ?? "",
          }}
        />
      </CardContent>
    </Card>
  );
}

/** Only damage recorded by hand can be taken away; a return's stays with its report. */
function RemoveCard({ ids }: { ids: Ids }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recorded by mistake?</CardTitle>
        <CardDescription>Removes it from the car. It stays in the Log.</CardDescription>
      </CardHeader>
      <CardContent>
        <ActionButton
          action={archiveDamageAction.bind(null, ids.vehicleId, ids.damageId)}
          label="Remove this damage"
          pendingLabel="Removing…"
          variant="danger"
          icon={<Archive aria-hidden />}
        />
      </CardContent>
    </Card>
  );
}

/** One piece of damage on a car: what and where, who had the car, photos, status and claim. */
export default async function DamagePage(props: { params: Promise<Ids> }) {
  const user = await requireUser();
  const ids = await props.params;
  const detail =
    isRecordId(ids.vehicleId) && isRecordId(ids.damageId)
      ? await loadDamageDetail({ database: appDb, storage: appFileStorage }, user.operatorId, {
          damageId: ids.damageId,
          timeZone: user.operatorTimezone,
        })
      : null;
  if (!detail || detail.record.vehicleId !== ids.vehicleId) {
    notFound();
  }
  return (
    <AppShell user={user}>
      <PageHeader
        backHref={`${carPath(ids.vehicleId)}?${TAB_PARAM}=damage`}
        backLabel={`${detail.car.rego} damage`}
        title={`Damage · ${detail.car.rego}`}
      />
      <WhatCard detail={detail} />
      <WhoHadItCard detail={detail} ids={ids} />
      <PhotosCard detail={detail} ids={ids} />
      <StatusCard detail={detail} ids={ids} />
      <ClaimCard detail={detail} ids={ids} user={user} />
      <ChargeRenterCard detail={detail} ids={ids} user={user} />
      {detail.record.damageMarkId ? null : <RemoveCard ids={ids} />}
      <HistoryCard
        user={user}
        subjects={[
          { entityType: ACTIVITY_ENTITY_TYPES.damageRecord, entityIds: [detail.record.id] },
          {
            entityType: ACTIVITY_ENTITY_TYPES.insuranceClaim,
            entityIds: detail.claim ? [detail.claim.id] : [],
          },
        ]}
        fieldLabel={damageFieldLabel}
        describeValue={describeDamageValue}
      />
    </AppShell>
  );
}
