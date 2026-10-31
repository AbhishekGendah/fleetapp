"use client";

import { Button } from "@fleetapp/ui/button";
import { FormError } from "@fleetapp/ui/form-message";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { Copy, Send } from "lucide-react";
import { useActionState, useState } from "react";

import { INITIAL_LINK_SEND_STATE, type LinkSendState } from "./link-send-state";

const COPIED_MS = 2000;

/**
 * Sends the details form link, then shows its address once so it can be
 * copied into a text message. It is never shown again: send again for a new one.
 */
export function DetailsLinkSender(props: {
  action: (state: LinkSendState) => Promise<LinkSendState>;
  hasLink: boolean;
}) {
  const [state, formAction, isPending] = useActionState(props.action, INITIAL_LINK_SEND_STATE);
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
          {isPending ? "Sending…" : props.hasLink ? "Send again" : "Send details form"}
        </Button>
      </form>
      {state.status === "failed" ? <FormError message={state.message} /> : null}
      {state.status === "sent" ? (
        <div className="flex flex-col gap-2">
          <p className="text-teal text-sm font-medium">
            Emailed. It works until {state.expiresText}.
          </p>
          <FormField
            htmlFor="details-link"
            label="Or copy the link into a text message"
            hint="Shown only now. If you need it again, press Send again for a new link."
          >
            <div className="flex gap-2">
              <Input id="details-link" value={state.url} readOnly className="min-w-0 flex-1" />
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
