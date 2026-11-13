"use server";

import {
  chargeNoticeStatusText,
  formTextValues,
  isRecordId,
  todayInTimeZone,
} from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import { appDb } from "../../../lib/app-db";
import { billingDependencies } from "../../../lib/billing/billing-dependencies";
import {
  issuedDocumentsText,
  issuePendingDocumentsQuietly,
} from "../../../lib/billing/billing-run";
import {
  giveChargeNotice,
  loadChargeNotices,
  type ChargeNotice,
} from "../../../lib/billing/charge-notice-run";
import type { IssuingActor } from "../../../lib/contracts/issued-documents";
import {
  changeDebitPlan,
  isStripeReadyFor,
  type DebitPlanChange,
} from "../../../lib/debits/debit-plans";
import {
  chargeWithCollectionSchema,
  COLLECTION_FIELDS,
  collectionInputSchema,
  collectionOf,
} from "../../../lib/debits/debit-plan-input";
import {
  CHARGE_FIELDS,
  REVERSAL_FIELDS,
  reversalInputSchema,
} from "../../../lib/ledger/ledger-input";
import {
  addCharge,
  recordPayment,
  reverseLine,
  type LedgerChangeResult,
} from "../../../lib/ledger/ledger-records";
import {
  MANUAL_PAYMENT_FIELDS,
  manualPaymentInputSchema,
} from "../../../lib/money/manual-payment-input";
import { carDamagePath, rentalPath } from "../../../lib/paths";
import { runUserChange } from "../../../lib/run-change";
import { balanceText } from "../../../lib/ledger/balance-text";
import { waiveDailyRate, type DailyRateWaiverResult } from "../../../lib/ledger/daily-rate-waiver";
import { chargeRentNow } from "../../../lib/ledger/rent-job";

const NOT_FOUND_MESSAGE = "That rental could not be found.";
const CHECK_MESSAGE = "Check the boxes marked in red, then try again.";
const REFUSED_MESSAGES: Readonly<Record<Exclude<LedgerChangeResult["status"], "saved">, string>> = {
  not_found: NOT_FOUND_MESSAGE,
  not_open: "This rental is a draft, cancelled or closed, so nothing can be added to it.",
  no_charge_type: "That charge type is no longer in use. Choose another.",
  not_reversible:
    "That line can't be reversed: it was reversed already, is a reversal, or came from Stripe (change it in Stripe).",
  collection_not_offered:
    "That way of collecting it isn't available for this rental now. Choose another, then try again.",
};

/**
 * The answer to a ledger change: refused with why, or saved, after issuing
 * the invoice, credit note or receipt it needs (named in the answer).
 */
async function answerFor(
  actor: IssuingActor,
  rentalId: string,
  result: LedgerChangeResult,
  saved: string,
): Promise<ChangeFormState> {
  if (result.status !== "saved") {
    return failedState(REFUSED_MESSAGES[result.status]);
  }
  const issued = await issuePendingDocumentsQuietly(billingDependencies(), actor, rentalId);
  const documents = issuedDocumentsText(issued);
  return savedState(
    `${saved}${documents ? ` ${documents}` : ""} ${balanceText(result.ledger.balanceCents)}.`,
  );
}

/** Bound to one rental (and a damage record of a car, from its page): a one-off charge. */
export async function addChargeAction(
  rentalId: string,
  damage: { recordId: string; vehicleId: string } | null,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = chargeWithCollectionSchema.safeParse(
    formTextValues(formData, [...CHARGE_FIELDS, ...COLLECTION_FIELDS]),
  );
  const isDamageValid =
    damage === null || (isRecordId(damage.recordId) && isRecordId(damage.vehicleId));
  if (!isRecordId(rentalId) || !isDamageValid) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  if (!parsed.success) {
    return failedState(CHECK_MESSAGE);
  }
  return runUserChange({
    description: "Adding a charge",
    pagesToRefresh: [
      rentalPath(rentalId),
      ...(damage ? [carDamagePath(damage.vehicleId, damage.recordId)] : []),
    ],
    change: async (actor, user) => {
      const collection = collectionOf(parsed.data);
      const result = await addCharge(appDb, actor, rentalId, {
        ...parsed.data,
        ...(damage ? { damageRecordId: damage.recordId } : {}),
        collection: collection
          ? { ...collection, isStripeReady: await isStripeReadyFor(appDb, actor.operatorId) }
          : null,
      });
      const answer = await answerFor(actor, rentalId, result, "Charge added.");
      if (result.status !== "saved" || answer.status !== "saved") {
        return answer;
      }
      // Its invoice was issued and emailed with the rest: say whether it went, and its debit day.
      const notices = await loadChargeNotices(
        appDb,
        actor.operatorId,
        rentalId,
        user.operatorTimezone,
      );
      const notice = noticeSentence(notices.get(result.lineId), user.operatorTimezone);
      return savedState(`${answer.message}${notice.text}`, notice.isWarning);
    },
  });
}

/**
 * " Invoice emailed Thu 12 Nov · debit on Sun 15 Nov." for the business's
 * confirmation; a warning when the invoice didn't go, so nothing is debited.
 */
function noticeSentence(
  notice: ChargeNotice | null | undefined,
  timeZone: string,
): { text: string; isWarning: boolean } {
  if (!notice) {
    return { text: "", isWarning: false };
  }
  const status = chargeNoticeStatusText({
    ...notice,
    today: todayInTimeZone(new Date(), timeZone),
  });
  const isDebited = notice.plan !== null && notice.plan !== "not_debited";
  return {
    text: ` ${status}.`,
    isWarning:
      notice.emailedOn === null || (isDebited && !notice.isCovered && notice.noticeDate === null),
  };
}

/** Bound to one rental: a payment received by bank transfer or cash. */
export async function recordPaymentAction(
  rentalId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  if (!isRecordId(rentalId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return runUserChange({
    description: "Recording a payment",
    pagesToRefresh: [rentalPath(rentalId)],
    change: async (actor, user) => {
      const today = todayInTimeZone(new Date(), user.operatorTimezone);
      const parsed = manualPaymentInputSchema(today).safeParse(
        formTextValues(formData, MANUAL_PAYMENT_FIELDS),
      );
      if (!parsed.success) {
        return failedState(CHECK_MESSAGE);
      }
      return answerFor(
        actor,
        rentalId,
        await recordPayment(appDb, actor, rentalId, parsed.data),
        "Payment recorded.",
      );
    },
  });
}

/** Bound to one line: undoes it exactly, with the reason the Renter will read. */
export async function reverseLineAction(
  rentalId: string,
  lineId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = reversalInputSchema.safeParse(formTextValues(formData, REVERSAL_FIELDS));
  if (!isRecordId(rentalId) || !isRecordId(lineId) || !parsed.success) {
    return failedState("Say why it is being reversed, then try again.");
  }
  return runUserChange({
    description: "Reversing a ledger line",
    pagesToRefresh: [rentalPath(rentalId)],
    change: async (actor, user) =>
      answerFor(
        actor,
        rentalId,
        await reverseLine(
          appDb,
          actor,
          { rentalId, lineId },
          parsed.data,
          todayInTimeZone(new Date(), user.operatorTimezone),
        ),
        "Reversed.",
      ),
  });
}

const WAIVER_MESSAGES: Readonly<Record<Exclude<DailyRateWaiverResult, "waived">, string>> = {
  not_found: NOT_FOUND_MESSAGE,
  not_repriced: "This rental was not re-priced at the daily rate, or it is already waived.",
};

/**
 * Waives the daily-rate re-pricing of a long-term rental back before its
 * minimum: the difference is credited at once with its adjustment note.
 */
export async function waiveDailyRateAction(
  rentalId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = reversalInputSchema.safeParse(formTextValues(formData, REVERSAL_FIELDS));
  if (!isRecordId(rentalId) || !parsed.success) {
    return failedState("Say why the daily rate is waived, then try again.");
  }
  return runUserChange({
    description: "Waiving the daily rate",
    pagesToRefresh: [rentalPath(rentalId)],
    change: async (actor) => {
      const result = await waiveDailyRate(appDb, actor, rentalId, parsed.data.note);
      if (result !== "waived") {
        return failedState(WAIVER_MESSAGES[result]);
      }
      await chargeRentNow(billingDependencies(), actor.operatorId, rentalId);
      return savedState("Daily rate waived: the difference is credited.");
    },
  });
}

const PLAN_CHANGE_MESSAGES: Readonly<Record<Exclude<DebitPlanChange, "changed">, string>> = {
  not_found: NOT_FOUND_MESSAGE,
  already_debited:
    "Part of this charge is already in a debit, so how it is collected stays as it is.",
  not_offered: REFUSED_MESSAGES.collection_not_offered,
  reversed: "This charge was reversed, so it is not collected.",
};

/** Bound to one charge: changes how it is collected, until any part of it is debited. */
export async function changeDebitPlanAction(
  rentalId: string,
  ledgerLineId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = collectionInputSchema.safeParse(formTextValues(formData, COLLECTION_FIELDS));
  const collection = parsed.success ? collectionOf(parsed.data) : null;
  if (!isRecordId(rentalId) || !isRecordId(ledgerLineId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  if (!collection) {
    return failedState(CHECK_MESSAGE);
  }
  return runUserChange({
    description: "Changing how a charge is collected",
    pagesToRefresh: [rentalPath(rentalId)],
    change: async (actor, user) => {
      const result = await changeDebitPlan(appDb, actor, { rentalId, ledgerLineId }, collection);
      if (result !== "changed") {
        return failedState(PLAN_CHANGE_MESSAGES[result]);
      }
      // A charge first planned as invoice only is told again, with its debit, before it is debited.
      const notice = await giveChargeNotice(billingDependencies(), actor, {
        rentalId,
        ledgerLineId,
      });
      const told = noticeSentence(notice, user.operatorTimezone);
      return savedState(`How it is collected is changed.${told.text}`, told.isWarning);
    },
  });
}
