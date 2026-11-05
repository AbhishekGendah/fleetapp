"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import * as React from "react";
import { useFormStatus } from "react-dom";

import { useCloseOnBack } from "../lib/use-close-on-back";
import { cn } from "../lib/utils";
import { Button, type ButtonProps } from "./button";

interface ConfirmButtonProps {
  /** On the button that asks, e.g. "Cancel this handover". */
  label: string;
  /** Before the label, e.g. a cross. */
  icon?: React.ReactNode;
  variant?: ButtonProps["variant"];
  /** Only the icon shows, in a square button; the label is still read out. Needs `icon`. */
  isIconOnly?: boolean;
  /** The question, e.g. "Cancel this handover?". */
  title: string;
  /** What happens if they go ahead, in plain words. */
  description: string;
  /** On the button that goes ahead, e.g. "Yes, cancel it". */
  confirmLabel: string;
  /** Shown on that button while it works, e.g. "Cancelling…". */
  pendingLabel: string;
  /** On the button that backs out. */
  keepLabel?: string;
  /** What going ahead does: a server action, or a step on the page. */
  action: (formData: FormData) => void | Promise<void>;
  className?: string;
}

const DEFAULT_KEEP_LABEL = "No, keep it";

/** The go-ahead button, showing it is working once pressed, so it is never pressed twice. */
function ConfirmSubmit(props: Pick<ConfirmButtonProps, "confirmLabel" | "pendingLabel">) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" disabled={pending} className="w-full sm:w-auto">
      {pending ? props.pendingLabel : props.confirmLabel}
    </Button>
  );
}

/**
 * A button for something hard to undo (cancel a checklist, remove a photo):
 * it asks first, saying what will happen, and only goes ahead on a second,
 * clearly labelled press (review A10-11). Built on Base UI's AlertDialog,
 * which is read out as an alert, keeps keyboard focus inside and starts it
 * on the safe choice; Escape, the back button or "keep" leave it as it was.
 */
export function ConfirmButton(props: ConfirmButtonProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const close = React.useCallback(() => setIsOpen(false), []);
  useCloseOnBack(isOpen, close);

  async function handleConfirm(formData: FormData): Promise<void> {
    await props.action(formData);
    close();
  }

  return (
    <AlertDialog.Root open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialog.Trigger
        render={
          <Button
            type="button"
            variant={props.variant ?? "danger"}
            size={props.isIconOnly ? "icon" : undefined}
            aria-label={props.isIconOnly ? props.label : undefined}
            className={cn(!props.isIconOnly && "w-full sm:w-auto", props.className)}
          />
        }
      >
        {props.icon}
        {props.isIconOnly ? null : props.label}
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        <AlertDialog.Popup className="bg-background text-foreground fixed inset-x-4 top-1/2 z-50 flex -translate-y-1/2 flex-col gap-3 rounded-xl p-4 shadow-xl sm:inset-x-auto sm:left-1/2 sm:w-full sm:max-w-md sm:-translate-x-1/2">
          <AlertDialog.Title className="text-primary text-lg font-bold">
            {props.title}
          </AlertDialog.Title>
          <AlertDialog.Description className="text-sm">{props.description}</AlertDialog.Description>
          <form action={handleConfirm} className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Close
              render={<Button type="button" variant="outline" className="w-full sm:w-auto" />}
            >
              {props.keepLabel ?? DEFAULT_KEEP_LABEL}
            </AlertDialog.Close>
            <ConfirmSubmit confirmLabel={props.confirmLabel} pendingLabel={props.pendingLabel} />
          </form>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
