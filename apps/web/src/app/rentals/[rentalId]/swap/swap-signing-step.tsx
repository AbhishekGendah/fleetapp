import { AT_SIGNING_WORDS, type BusinessAcceptance } from "@fleetapp/core";
import { ContractReader } from "@fleetapp/ui/contract-reader";

import {
  checklistFingerprint,
  shownChecklistOf,
} from "../../../../lib/handover/checklist-fingerprint";
import type { SwapSigningView } from "../../../../lib/handover/complete-swap";
import { AcceptanceSummary } from "../handover/acceptance-summary";
import { LazySwapForm } from "./lazy-swap-form";
import { swapRefusalMessage } from "./swap-state";

const NO_NEW_DAMAGE = "No new damage was found on it.";

/**
 * Everything the Renter reads before signing the swap (review G9-1): the
 * business's swap form in full, the damage found on the car handed back,
 * and both cars' saved kilometres, fuel and keys. The form sends back
 * which swap, checklists and form version were shown.
 */
export function SwapSigningStep(props: {
  rentalId: string;
  signing: SwapSigningView | null;
  renterName: string;
  privacyLine: React.ReactNode;
  oldCar: string;
  newCar: string;
  /** A business's car: its driver signs the swap, for the business. */
  forBusiness?: BusinessAcceptance;
}) {
  const { signing } = props;
  if (!signing) {
    return <p className="text-muted-foreground text-sm">This swap could not be found.</p>;
  }
  if (signing.form.status !== "filled") {
    return <p className="text-sm">{swapRefusalMessage(signing.form)}</p>;
  }
  const returned = shownChecklistOf(signing.returned);
  const handedOver = shownChecklistOf(signing.handedOver);
  if (!returned || !handedOver) {
    return null;
  }
  const newDamage = signing.returned.damageMarks.map((mark) => mark.description);
  return (
    <div className="flex flex-col gap-4">
      <ContractReader content={signing.form.document} label="The car swap form" />
      <div className="flex flex-col gap-2 text-sm">
        <p className="font-medium">Damage found on {props.oldCar}</p>
        {newDamage.length === 0 ? (
          <p>{NO_NEW_DAMAGE}</p>
        ) : (
          <ul className="list-disc pl-5">
            {newDamage.map((description, index) => (
              <li key={index}>{description}</li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-sm">{props.renterName}: by signing, you agree to the swap form and say:</p>
      <AcceptanceSummary
        car={props.oldCar}
        verb="returned"
        atText={AT_SIGNING_WORDS}
        shown={returned}
        forBusiness={props.forBusiness}
      />
      <AcceptanceSummary
        car={props.newCar}
        verb="received"
        atText={AT_SIGNING_WORDS}
        shown={handedOver}
        forBusiness={props.forBusiness}
      />
      <LazySwapForm
        rentalId={props.rentalId}
        returnInspectionId={signing.returned.inspectionId}
        handoverInspectionId={signing.handedOver.inspectionId}
        renterName={props.renterName}
        privacyLine={props.privacyLine}
        oldCar={props.oldCar}
        isForBusiness={props.forBusiness !== undefined}
        shown={{
          swapId: signing.swapId,
          returnFingerprint: checklistFingerprint(signing.returned),
          handoverFingerprint: checklistFingerprint(signing.handedOver),
          swapTemplateVersionId: signing.form.templateVersionId,
          swapFormFingerprint: signing.form.fingerprint,
        }}
      />
    </div>
  );
}
