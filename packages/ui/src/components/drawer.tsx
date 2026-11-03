"use client";

import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import * as React from "react";

import { useCloseOnBack } from "../lib/use-close-on-back";
import { useIsPhoneWidth } from "../lib/phone-width";
import { Button } from "./button";

export interface DrawerProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  children: React.ReactNode;
}

/**
 * A panel that slides in over the page without leaving it: up from the
 * bottom on a phone, in from the right on a computer. Swipe it away, press
 * Escape, Close or the phone's back button to shut it. Built on Base UI's
 * Drawer, which keeps keyboard focus inside while open and returns it
 * afterwards, and is read out as a dialog with its title.
 */
export function Drawer({ isOpen, onOpenChange, title, children }: DrawerProps): React.JSX.Element {
  const isPhone = useIsPhoneWidth();
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  useCloseOnBack(isOpen, close);

  return (
    <BaseDrawer.Root
      open={isOpen}
      onOpenChange={(next) => onOpenChange(next)}
      swipeDirection={isPhone ? "down" : "right"}
    >
      <BaseDrawer.Portal>
        <BaseDrawer.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        <BaseDrawer.Viewport>
          <BaseDrawer.Popup className="bg-background text-foreground fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-xl shadow-xl sm:inset-x-auto sm:top-0 sm:right-0 sm:h-dvh sm:max-h-none sm:w-full sm:max-w-md sm:rounded-none">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
              <BaseDrawer.Title className="text-primary text-lg font-bold">
                {title}
              </BaseDrawer.Title>
              <BaseDrawer.Close render={<Button type="button" variant="ghost" />}>
                Close
              </BaseDrawer.Close>
            </div>
            <BaseDrawer.Content className="overflow-y-auto p-4">{children}</BaseDrawer.Content>
          </BaseDrawer.Popup>
        </BaseDrawer.Viewport>
      </BaseDrawer.Portal>
    </BaseDrawer.Root>
  );
}
