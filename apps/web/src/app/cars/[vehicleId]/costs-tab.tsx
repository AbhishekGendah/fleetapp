import {
  formatCalendarDate,
  formatCents,
  formatDateTimeInTimeZone,
  PURCHASE_SOURCE_LABELS,
  VEHICLE_COST_KIND_LABELS,
  type AmountWithGst,
} from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { Archive, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { appDb } from "../../../lib/app-db";
import { listAttachments, type Attachment } from "../../../lib/files/attachments";
import { carPath } from "../../../lib/paths";
import type { SignedInUser } from "../../../lib/require-user";
import {
  emptyPurchaseForm,
  emptySaleForm,
  purchaseFormValues,
  saleFormValues,
} from "../../../lib/vehicles/cost-input";
import { loadCarCosts, type CarCosts } from "../../../lib/vehicles/cost-queries";
import type { VehicleDetail } from "../../../lib/vehicles/vehicle-queries";
import { Attachments } from "../attachments";
import { CostForm } from "../cost-form";
import { PurchaseForm } from "../purchase-form";
import { SaleForm } from "../sale-form";
import { setArchivedAction } from "./actions";
import {
  addCostAction,
  cancelSaleAction,
  removeCostAction,
  savePurchaseAction,
  saveSaleAction,
} from "./cost-actions";

/** "$1,100.00 incl. $100.00 GST", or just the amount when there is no GST. */
function amountInWords(amount: AmountWithGst): string {
  const total = formatCents(amount.amountCents);
  return amount.gstCents > 0 ? `${total} incl. ${formatCents(amount.gstCents)} GST` : total;
}

function TotalsCard({ costs }: { costs: CarCosts }) {
  const { totals } = costs;
  const lines = [
    ["Bought for", totals.bought ? amountInWords(totals.bought) : "Not recorded"],
    ["Refurb", amountInWords(totals.refurb)],
    ["Other costs", amountInWords(totals.otherCosts)],
    ["Sold for", totals.sold ? amountInWords(totals.sold) : "Not sold"],
  ] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Totals</CardTitle>
        <CardDescription>
          Rego and insurance are on their own tab, and join these totals with the profit report.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
          {lines.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
          {totals.differenceExcludingGstCents === null ? null : (
            <div className="contents font-semibold">
              <dt>Difference</dt>
              <dd>
                {formatCents(totals.differenceExcludingGstCents)}{" "}
                <span className="text-muted-foreground font-normal">excluding GST</span>
              </dd>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

interface CostsCardProps {
  vehicle: VehicleDetail;
  costs: CarCosts;
  user: SignedInUser;
  attachments: readonly Attachment[];
}

/** Purchase and sale papers show another person's licence and details. */
const PRIVATE_PAPERS_NOTE = "Papers attached here are kept privately, and every opening is logged.";

function PurchaseCard({ vehicle, costs, user, attachments }: CostsCardProps) {
  const { purchase } = costs;
  const isEditable = vehicle.archivedAt === null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Purchase</CardTitle>
        <CardDescription>
          {purchase
            ? `Bought ${formatCalendarDate(purchase.purchasedOn)} from ${PURCHASE_SOURCE_LABELS[purchase.source].toLowerCase()}, ${amountInWords({ amountCents: purchase.priceCents, gstCents: purchase.gstCents })}.`
            : "Who you bought the car from, and for how much."}
        </CardDescription>
      </CardHeader>
      {!isEditable && !purchase ? null : (
        <CardContent className="flex flex-col gap-4">
          {purchase ? (
            <div className="flex flex-col gap-1">
              <p className="text-muted-foreground text-xs">{PRIVATE_PAPERS_NOTE}</p>
              <Attachments
                target={{ kind: "purchase", id: purchase.id }}
                attachments={attachments}
                isEditable={isEditable}
                pagePath={carPath(vehicle.id)}
              />
            </div>
          ) : null}
          {isEditable ? (
            <FormDialog
              triggerLabel={purchase ? "Edit purchase" : "Add purchase"}
              triggerIcon={purchase ? <Pencil aria-hidden /> : <Plus aria-hidden />}
              isMainAction={!purchase}
              title={purchase ? "Edit the purchase" : "Add the purchase"}
            >
              <PurchaseForm
                initialValues={
                  purchase
                    ? purchaseFormValues(purchase, costs.purchaseKilometres)
                    : emptyPurchaseForm()
                }
                action={savePurchaseAction.bind(null, vehicle.id)}
                isGstRegistered={user.isGstRegistered}
                nearState={vehicle.regoState}
                submitLabel={purchase ? "Save changes" : "Save purchase"}
              />
            </FormDialog>
          ) : null}
        </CardContent>
      )}
    </Card>
  );
}

function OtherCostsCard({ vehicle, costs, user, attachments }: CostsCardProps) {
  const isEditable = vehicle.archivedAt === null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Other costs</CardTitle>
        <CardDescription>Refurbs, repairs and anything else spent on the car.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {costs.costs.length === 0 ? (
          <p className="text-muted-foreground text-sm">No costs yet.</p>
        ) : (
          <RecordList label="Costs">
            {costs.costs.map((cost) => (
              <RecordItem
                key={cost.id}
                title={cost.description}
                amount={amountInWords({ amountCents: cost.costCents, gstCents: cost.gstCents })}
                details={
                  <p>
                    {VEHICLE_COST_KIND_LABELS[cost.kind]} · {formatCalendarDate(cost.incurredOn)}
                  </p>
                }
                actions={
                  isEditable ? (
                    <ActionButton
                      action={removeCostAction.bind(null, vehicle.id, cost.id)}
                      label="Remove cost"
                      pendingLabel="Removing…"
                      variant="danger"
                      icon={<Trash2 aria-hidden />}
                    />
                  ) : undefined
                }
              >
                <Attachments
                  target={{ kind: "cost", id: cost.id }}
                  attachments={attachments}
                  isEditable={isEditable}
                  pagePath={carPath(vehicle.id)}
                />
              </RecordItem>
            ))}
          </RecordList>
        )}
        {isEditable ? (
          <FormDialog
            triggerLabel="Add a cost"
            triggerIcon={<Plus aria-hidden />}
            isMainAction
            title="Add a cost"
          >
            <CostForm
              action={addCostAction.bind(null, vehicle.id)}
              isGstRegistered={user.isGstRegistered}
            />
          </FormDialog>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SaleSummary({ vehicle, costs, user, attachments }: CostsCardProps) {
  const { sale } = costs;
  if (!sale) {
    return null;
  }
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        Handed over {formatDateTimeInTimeZone(sale.soldAt, user.operatorTimezone)} to{" "}
        <span className="font-medium">{sale.buyerName}</span>,{" "}
        {amountInWords({ amountCents: sale.priceCents, gstCents: sale.gstCents })}.
      </p>
      {sale.transferLodgedOn ? (
        <p className="text-muted-foreground">
          Transfer lodged {formatCalendarDate(sale.transferLodgedOn)}
          {sale.transferReference ? ` (ref ${sale.transferReference})` : ""}.
        </p>
      ) : (
        <p className="text-attention font-medium">
          Transfer not lodged yet: fines can still come to you. Add the date with Edit sale once it
          is.
        </p>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-xs">{PRIVATE_PAPERS_NOTE}</p>
        <Attachments
          target={{ kind: "sale", id: sale.id }}
          attachments={attachments}
          isEditable={vehicle.archivedAt === null}
          pagePath={carPath(vehicle.id)}
        />
      </div>
      {vehicle.archivedAt ? null : (
        <div className="flex flex-wrap gap-2">
          <ActionButton
            action={setArchivedAction.bind(null, vehicle.id, true)}
            label="Archive this car"
            pendingLabel="Archiving…"
            icon={<Archive aria-hidden />}
          />
          <ActionButton
            action={cancelSaleAction.bind(null, vehicle.id)}
            label="Cancel this sale"
            pendingLabel="Cancelling…"
            variant="danger"
            icon={<Undo2 aria-hidden />}
          />
        </div>
      )}
    </div>
  );
}

function SaleCard(props: CostsCardProps) {
  const { vehicle, costs, user } = props;
  const { sale } = costs;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sale</CardTitle>
        <CardDescription>
          {sale
            ? "Once the transfer is lodged and nothing more is due, archive the car."
            : "Saving a sale sets the car to Sold."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <SaleSummary {...props} />
        {vehicle.archivedAt ? null : (
          <FormDialog
            triggerLabel={sale ? "Edit sale" : "Record sale"}
            triggerIcon={sale ? <Pencil aria-hidden /> : <Plus aria-hidden />}
            isMainAction={!sale}
            title={sale ? "Edit the sale" : "Record the sale"}
          >
            <SaleForm
              initialValues={sale ? saleFormValues(sale, user.operatorTimezone) : emptySaleForm()}
              action={saveSaleAction.bind(null, vehicle.id)}
              isGstRegistered={user.isGstRegistered}
              timeZone={user.operatorTimezone}
              nearState={vehicle.regoState}
              submitLabel={sale ? "Save changes" : "Save sale"}
            />
          </FormDialog>
        )}
      </CardContent>
    </Card>
  );
}

/** A car's Costs tab: what it cost, what was spent on it, and what it sold for. */
export async function CostsTab({ vehicle, user }: { vehicle: VehicleDetail; user: SignedInUser }) {
  const [costs, attachments] = await Promise.all([
    loadCarCosts(appDb, user.operatorId, vehicle.id),
    listAttachments(appDb, user.operatorId, { vehicleId: vehicle.id }),
  ]);
  const props = { vehicle, costs, user, attachments };
  return (
    <>
      <TotalsCard costs={costs} />
      <PurchaseCard {...props} />
      <OtherCostsCard {...props} />
      <SaleCard {...props} />
    </>
  );
}
