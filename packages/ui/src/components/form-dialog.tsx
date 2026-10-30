"use client";

import * as React from "react";

import { Button, type ButtonProps } from "./button";

interface DialogControls {
  close: () => void;
}

const DialogContext = React.createContext<DialogControls | null>(null);

/** Inside a `FormDialog`: closes it, e.g. once its form has saved. Null anywhere else. */
export function useDialogClose(): (() => void) | null {
  return React.useContext(DialogContext)?.close ?? null;
}

interface FormDialogProps {
  /** On the button that opens it, e.g. "Add rego renewal". */
  triggerLabel: string;
  title: string;
  triggerVariant?: ButtonProps["variant"];
  children: React.ReactNode;
}

/**
 * A button that opens a form in a pop-up: full screen on a phone, a centred
 * panel on a computer. The form is built fresh each time it opens, so it
 * always starts empty, and a form inside closes it once it has saved.
 * Escape or Close shuts it without saving. Uses the browser's own dialog,
 * which keeps keyboard focus inside and is read out as a dialog.
 */
export function FormDialog(props: FormDialogProps) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = React.useState(false);
  const titleId = React.useId();

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen && dialog && !dialog.open) {
      dialog.showModal();
    }
  }, [isOpen]);

  const controls = React.useMemo<DialogControls>(
    () => ({ close: () => dialogRef.current?.close() }),
    [],
  );

  return (
    <>
      <Button
        type="button"
        variant={props.triggerVariant ?? "outline"}
        className="sm:self-start"
        onClick={() => setIsOpen(true)}
      >
        {props.triggerLabel}
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => setIsOpen(false)}
        className="bg-background text-foreground m-0 h-dvh max-h-none w-full max-w-none p-0 backdrop:bg-black/40 sm:m-auto sm:h-auto sm:max-h-[90dvh] sm:max-w-lg sm:rounded-xl sm:shadow-xl"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
            <h2 id={titleId} className="text-primary text-lg font-bold">
              {props.title}
            </h2>
            <Button type="button" variant="ghost" onClick={controls.close}>
              Close
            </Button>
          </div>
          <div className="overflow-y-auto p-4">
            {isOpen ? (
              <DialogContext.Provider value={controls}>{props.children}</DialogContext.Provider>
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  );
}
