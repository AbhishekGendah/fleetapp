"use client";

import { useActionState, useCallback } from "react";

import { INITIAL_LINK_SEND_STATE, type LinkSendState } from "../lib/renter-links/link-send-state";

/**
 * Sends a Renter link from a button, telling `onSent` when a new link is
 * made, so a sibling showing an older one can hide it (review KS-6).
 */
export function useLinkSend(
  action: (state: LinkSendState) => Promise<LinkSendState>,
  onSent: (() => void) | undefined,
): [LinkSendState, () => void, boolean] {
  const sendAndTell = useCallback(
    async (previous: LinkSendState): Promise<LinkSendState> => {
      const next = await action(previous);
      if (next.status === "sent") {
        onSent?.();
      }
      return next;
    },
    [action, onSent],
  );
  return useActionState(sendAndTell, INITIAL_LINK_SEND_STATE);
}
