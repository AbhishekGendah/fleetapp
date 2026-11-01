"use client";

import { useEffect } from "react";

import { forgetDraft } from "./details-draft";

/**
 * Shown with "Thanks": the details were sent, so nothing typed stays on the
 * phone, even if the answer to sending was lost on the way back.
 */
export function ForgetDraft(props: { linkId: string }): null {
  useEffect(() => {
    forgetDraft(props.linkId);
  }, [props.linkId]);
  return null;
}
