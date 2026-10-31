"use client";

import { LINK_CODE_DIGITS } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { CodeInput } from "@fleetapp/ui/code-input";
import { FormError } from "@fleetapp/ui/form-message";
import { FormField } from "@fleetapp/ui/form-field";
import { Mail } from "lucide-react";
import { useActionState, useRef, useState } from "react";

import { INITIAL_CODE_STEP_STATE, type CodeStepState } from "./link-state";

/**
 * The first visit on a phone: email a code, then type it. Nothing about the
 * Renter is shown until it is right; once right, the page reloads with the form.
 */
export function CodeStep(props: {
  maskedEmail: string;
  sendCode: (state: CodeStepState) => Promise<CodeStepState>;
  checkCode: (state: CodeStepState, formData: FormData) => Promise<CodeStepState>;
}) {
  const [sendState, sendAction, isSending] = useActionState(
    props.sendCode,
    INITIAL_CODE_STEP_STATE,
  );
  const [checkState, checkAction, isChecking] = useActionState(
    props.checkCode,
    INITIAL_CODE_STEP_STATE,
  );
  const [code, setCode] = useState("");
  const checkFormRef = useRef<HTMLFormElement>(null);
  const isCodeSent = sendState.status === "code_sent" || checkState.status === "problem";

  return (
    <div className="flex flex-col gap-6">
      <form action={sendAction} className="flex flex-col gap-3">
        <p className="text-sm">
          To keep your details safe, we first email a code to {props.maskedEmail}.
        </p>
        <Button
          type="submit"
          variant={isCodeSent ? "outline" : "default"}
          disabled={isSending}
          className="w-full"
        >
          <Mail aria-hidden />
          {isSending ? "Sending…" : isCodeSent ? "Email me a new code" : "Email me a code"}
        </Button>
        {sendState.status === "code_sent" ? (
          <p className="text-teal text-sm font-medium">Sent. Check your email (and junk folder).</p>
        ) : null}
        {sendState.status === "problem" ? <FormError message={sendState.message} /> : null}
      </form>
      {isCodeSent ? (
        <form ref={checkFormRef} action={checkAction} className="flex flex-col gap-3">
          <FormField htmlFor="code" label="Type the code">
            <CodeInput
              id="code"
              name="code"
              value={code}
              onChange={setCode}
              length={LINK_CODE_DIGITS}
              autoFocus
              isDisabled={isChecking}
              onComplete={() => checkFormRef.current?.requestSubmit()}
            />
          </FormField>
          {checkState.status === "problem" ? <FormError message={checkState.message} /> : null}
          <Button
            type="submit"
            disabled={isChecking || code.length < LINK_CODE_DIGITS}
            className="w-full"
          >
            {isChecking ? "Checking…" : "Check code"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
