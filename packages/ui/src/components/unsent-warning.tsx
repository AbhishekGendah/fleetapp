"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";

import { Button } from "./button";

/** Asked before signing out would lose something kept only on this device. */
export default function UnsentWarning(props: {
  message: string;
  isSigningOut: boolean;
  onStay: () => void;
  onSignOut: () => Promise<void>;
}): React.JSX.Element {
  return (
    <AlertDialog.Root open onOpenChange={(isOpen) => !isOpen && props.onStay()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        <AlertDialog.Popup className="bg-background text-foreground fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl p-4 shadow-xl">
          <AlertDialog.Title className="text-primary text-lg font-bold">
            Not sent yet
          </AlertDialog.Title>
          <AlertDialog.Description>{props.message}</AlertDialog.Description>
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <AlertDialog.Close render={<Button type="button" />}>Stay signed in</AlertDialog.Close>
            <Button
              type="button"
              variant="danger"
              onClick={props.onSignOut}
              disabled={props.isSigningOut}
            >
              Sign out and lose them
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
