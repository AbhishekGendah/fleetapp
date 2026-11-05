"use client";

import { Dialog } from "@base-ui/react/dialog";
import * as React from "react";

import { useCloseOnBack } from "../lib/use-close-on-back";
import { cn } from "../lib/utils";
import { Button, type ButtonProps } from "./button";

interface DialogControls {
  /** Closes it; a message given is shown and read out beside its button (review A10-8). */
  close: (message?: string) => void;
}

const DialogContext = React.createContext<DialogControls | null>(null);

/** Inside a `FormDialog`: closes it, e.g. once its form has saved. Null anywhere else. */
export function useDialogClose(): ((message?: string) => void) | null {
  return React.useContext(DialogContext)?.close ?? null;
}

interface FormDialogProps {
  /** On the button that opens it, e.g. "Add rego renewal". */
  triggerLabel: string;
  title: string;
  triggerVariant?: ButtonProps["variant"];
  /** Before the label, e.g. a plus. */
  triggerIcon?: React.ReactNode;
  /** Full width on a phone: the card's main action. */
  isMainAction?: boolean;
  children: React.ReactNode;
}

/**
 * A button that opens a form in a pop-up: full screen on a phone, a centred
 * panel on a computer. The form is built fresh each time it opens, so it
 * always starts empty, and a form inside closes it once it has saved.
 * Escape, Close or the phone's back button shuts it without saving. Built on
 * Base UI's Dialog, which keeps keyboard focus inside, returns it to the
 * button afterwards and is read out as a dialog.
 */
export function FormDialog(props: FormDialogProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [closedMessage, setClosedMessage] = React.useState<string | null>(null);
  const controls = React.useMemo<DialogControls>(
    () => ({
      close: (message) => {
        setClosedMessage(message ?? null);
        setIsOpen(false);
      },
    }),
    [],
  );
  const closeOnBack = React.useCallback(() => controls.close(), [controls]);
  useCloseOnBack(isOpen, closeOnBack);

  function handleOpenChange(open: boolean): void {
    if (open) {
      setClosedMessage(null);
    }
    setIsOpen(open);
  }

  return (
    <>
      <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
        <Dialog.Trigger
          render={
            <Button
              type="button"
              variant={props.triggerVariant ?? (props.isMainAction ? "default" : "outline")}
              className={cn("sm:self-start", props.isMainAction && "w-full sm:w-auto")}
            />
          }
        >
          {props.triggerIcon}
          {props.triggerLabel}
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Popup className="bg-background text-foreground fixed inset-0 z-50 flex h-dvh w-full flex-col sm:inset-auto sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[90dvh] sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:shadow-xl">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
              <Dialog.Title className="text-primary text-lg font-bold">{props.title}</Dialog.Title>
              <Dialog.Close render={<Button type="button" variant="ghost" />}>Close</Dialog.Close>
            </div>
            <div className="overflow-y-auto p-4">
              <DialogContext.Provider value={controls}>{props.children}</DialogContext.Provider>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      {/* What the form said as it closed, e.g. "Payment recorded", seen and read out. */}
      <p role="status" className="text-sm empty:sr-only">
        {closedMessage}
      </p>
    </>
  );
}
