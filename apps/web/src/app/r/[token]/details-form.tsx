"use client";

import type { LicenceSide } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { FormError } from "@fleetapp/ui/form-message";
import { FormSection } from "@fleetapp/ui/form-section";
import { RequiredFieldsNote } from "@fleetapp/ui/input";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState, useEffect, useMemo, useState } from "react";

import type { AddressLookup } from "../../../components/address-search";
import {
  DETAILS_FORM_FIELDS,
  isRequiredDetailsField,
  parseDetailsForm,
  type DetailsFormValues,
} from "../../../lib/renter-links/details-form-input";
import { LicenceFields } from "../../renters/[renterId]/licence-fields";
import { RenterDetailsFields } from "../../renters/renter-details-fields";
import { useDetailsDraft } from "./details-draft";
import {
  getAddressForLinkAction,
  searchAddressesForLinkAction,
  sendDetailsAction,
} from "./form-actions";
import { LinkPhotos } from "./link-photos";
import { INITIAL_SEND_DETAILS_STATE } from "./link-state";
import { PrivacyNotice } from "./privacy-notice";
import { SentBackNote } from "./sent-back-note";
import { SentThanks } from "./sent-thanks";

const PHOTOS_MISSING_MESSAGE = "Add a photo of the front and the back of your licence.";

export interface DetailsFormProps {
  token: string;
  linkId: string;
  operatorName: string;
  /** The Operator's today, for the date checks. */
  today: string;
  /** When the link ends, as an ISO time: a kept draft is ignored after it. */
  expiresAt: string;
  initialValues: DetailsFormValues;
  photos: Readonly<Record<LicenceSide, boolean>>;
  /** The Operator's note when what the Renter last sent came back for a change. */
  sentBackNote: string | null;
}

function useLinkAddressLookup(token: string): AddressLookup {
  return useMemo(
    () => ({
      search: searchAddressesForLinkAction.bind(null, token),
      getAddress: getAddressForLinkAction.bind(null, token),
    }),
    [token],
  );
}

/**
 * The form a Renter fills in through their link (rule 26): their details as
 * on file to correct, the licence typed and photographed fresh. Nothing on
 * their record changes until the Operator approves what was sent.
 */
export function DetailsForm(props: DetailsFormProps) {
  const sendDetails = useMemo(() => sendDetailsAction.bind(null, props.token), [props.token]);
  const [state, formAction, isPending] = useActionState(sendDetails, INITIAL_SEND_DETAILS_STATE);
  const [photos, setPhotos] = useState(props.photos);
  const [photoMessage, setPhotoMessage] = useState<string | null>(null);
  const addressLookup = useLinkAddressLookup(props.token);
  const form = useFormFields({
    fields: DETAILS_FORM_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => {
      const parsed = parseDetailsForm(values, props.today);
      return parsed.success ? {} : parsed.errors;
    },
    isRequired: isRequiredDetailsField,
  });
  const { clearDraft } = useDetailsDraft(form, props.linkId, props.expiresAt);
  const isSent = state.status === "sent";

  useEffect(() => {
    if (isSent) {
      clearDraft();
    }
  }, [isSent, clearDraft]);

  if (isSent) {
    return <SentThanks operatorName={props.operatorName} />;
  }

  function handlePhotoSent(side: LicenceSide): void {
    setPhotos((previous) => ({ ...previous, [side]: true }));
    setPhotoMessage(null);
  }

  function sendIfPhotosAdded(formData: FormData): void {
    if (!photos.front || !photos.back) {
      setPhotoMessage(PHOTOS_MISSING_MESSAGE);
      return;
    }
    formAction(formData);
  }

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(sendIfPhotosAdded)}
      noValidate
      className="flex flex-col gap-8"
    >
      {props.sentBackNote ? (
        <SentBackNote operatorName={props.operatorName} note={props.sentBackNote} />
      ) : null}
      <PrivacyNotice operatorName={props.operatorName} />
      <RequiredFieldsNote />
      <RenterDetailsFields
        form={form}
        today={props.today}
        isRequired={(field) => isRequiredDetailsField(field, form.values)}
        title="Your details"
        nameHints={{
          fullName: "As on your licence.",
          preferredName: "What you like to be called.",
        }}
        addressLookup={addressLookup}
      />
      <FormSection title="Your licence">
        <LicenceFields form={form} />
      </FormSection>
      <FormSection title="Photos of your licence">
        <p className="text-muted-foreground text-sm">
          The front and the back, flat and in good light, with every word readable.
        </p>
        <LinkPhotos token={props.token} photos={photos} onPhotoSent={handlePhotoSent} />
        <FormError message={photoMessage} />
      </FormSection>

      {form.isResultShown && !isPending && state.status === "problem" ? (
        <FormError message={state.message} />
      ) : null}
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? "Sending…" : `Send to ${props.operatorName}`}
      </Button>
    </form>
  );
}
