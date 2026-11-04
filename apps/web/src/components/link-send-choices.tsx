"use client";

import { useState } from "react";

import type { LinkSendState } from "../lib/renter-links/link-send-state";
import { OnTheSpotLink } from "./on-the-spot-link";
import { RenterLinkSender } from "./renter-link-sender";

type Choice = "email" | "on_the_spot";

/**
 * The two ways to hand a Renter their link: emailed (with a copy box), or
 * a code to scan on the spot. Each makes a new link that cancels the last,
 * so only the newest is ever shown (review KS-6).
 */
export function LinkSendChoices(props: {
  emailAction: (state: LinkSendState) => Promise<LinkSendState>;
  onTheSpotAction: (state: LinkSendState) => Promise<LinkSendState>;
  hasLink: boolean;
  sendLabel: string;
  urlFieldId: string;
  onTheSpotLabel: string;
  onTheSpotInstructions: string;
}) {
  const [latest, setLatest] = useState<Choice | null>(null);
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <RenterLinkSender
        action={props.emailAction}
        hasLink={props.hasLink}
        sendLabel={props.sendLabel}
        urlFieldId={props.urlFieldId}
        onSent={() => setLatest("email")}
        isCurrent={latest !== "on_the_spot"}
      />
      <OnTheSpotLink
        action={props.onTheSpotAction}
        label={props.onTheSpotLabel}
        instructions={props.onTheSpotInstructions}
        onSent={() => setLatest("on_the_spot")}
        isCurrent={latest !== "email"}
      />
    </div>
  );
}
