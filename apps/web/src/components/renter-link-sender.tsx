"use client";

import { Button } from "@fleetapp/ui/button";
import { FormError } from "@fleetapp/ui/form-message";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { Copy, Send } from "lucide-react";
import { useState } from "react";

import type { LinkSendState } from "../lib/renter-links/link-send-state";
import { useLinkSend } from "./use-link-send";

const COPIED_MS = 2000;

/**
 * Sends a Renter link, then shows its address once so it can be copied into
 * a text message. It is never shown again: send again for a new one.
 */
export function RenterLinkSender(props: {
  action: (state: LinkSendState) => Promise<LinkSendState>;
  /** Told when a new link is made, so a sibling showing an older one can hide it. */
  onSent?: () => void;
  /** False once a newer link replaced the one this shows. */
  isCurrent?: boolean;
  hasLink: boolean;
  /** The button before any link is sent, e.g. "Send details form". */
  sendLabel: string;
  /** The id of the box showing the address; unique on the page. */
  urlFieldId: string;
}) {
  const [state, formAction, isPending] = useLinkSend(props.action, props.onSent);
  // A newer link made by the other button cancelled this one: never leave it on screen (review KS-6).
  const isCurrent = props.isCurrent ?? true;
  const [isCopied, setIsCopied] = useState(false);

  async function handleCopy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), COPIED_MS);
    } catch (error) {
      console.warn("Copying the link failed", error instanceof Error ? error.name : "");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction}>
        <Button
          type="submit"
          variant={props.hasLink ? "outline" : "default"}
          disabled={isPending}
          className="w-full sm:w-auto"
        >
          <Send aria-hidden />
          {isPending ? "Sending…" : props.hasLink ? "Send again" : props.sendLabel}
        </Button>
      </form>
      {state.status === "failed" ? <FormError message={state.message} /> : null}
      {state.status === "sent" && isCurrent ? (
        <div className="flex flex-col gap-2">
          {state.isEmailed ? (
            <p className="text-teal text-sm font-medium">
              Emailed. It works until {state.expiresText}.
            </p>
          ) : (
            <p role="alert" className="text-attention text-sm font-medium">
              The email could not be sent. Copy the link below and send it yourself. It works until{" "}
              {state.expiresText}.
            </p>
          )}
          <FormField
            htmlFor={props.urlFieldId}
            label="Or copy the link into a text message"
            hint="Shown only now. If you need it again, press Send again for a new link."
          >
            <div className="flex gap-2">
              <Input id={props.urlFieldId} value={state.url} readOnly className="min-w-0 flex-1" />
              <Button type="button" variant="outline" onClick={() => void handleCopy(state.url)}>
                <Copy aria-hidden />
                {isCopied ? "Copied" : "Copy"}
              </Button>
            </div>
          </FormField>
        </div>
      ) : null}
    </div>
  );
}
