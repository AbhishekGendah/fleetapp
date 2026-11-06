"use client";

import { Menu as BaseMenu } from "@base-ui/react/menu";
import * as React from "react";

import { cn } from "../lib/utils";
import type { MenuEntry, MenuLinkComponent, MenuPopupProps } from "./menu";

/** Every item is a full-width row at least 44px tall (rule 24). */
const ITEM_CLASSES =
  "flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 text-left text-sm font-semibold text-foreground outline-none select-none data-[highlighted]:bg-muted data-[disabled]:cursor-default data-[disabled]:opacity-50 [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

/** The page being shown is marked in teal, as in the side menu. */
const CURRENT_ITEM_CLASSES = "text-teal font-bold [&_svg]:text-teal";

function MenuItem({
  entry,
  linkComponent: LinkComponent,
}: {
  entry: MenuEntry;
  linkComponent?: MenuLinkComponent;
}): React.JSX.Element {
  if (entry.kind === "separator") {
    return <BaseMenu.Separator className="my-1 border-t" />;
  }
  if (entry.kind === "action") {
    return (
      <BaseMenu.Item className={ITEM_CLASSES} disabled={entry.isDisabled} onClick={entry.onSelect}>
        {entry.icon}
        {entry.label}
      </BaseMenu.Item>
    );
  }
  return (
    <BaseMenu.LinkItem
      href={entry.href}
      closeOnClick
      aria-current={entry.isCurrent ? "page" : undefined}
      className={cn(ITEM_CLASSES, entry.isCurrent && CURRENT_ITEM_CLASSES)}
      render={LinkComponent ? <LinkComponent href={entry.href} /> : undefined}
    >
      {entry.icon}
      {entry.label}
    </BaseMenu.LinkItem>
  );
}

/** The Menu once wanted: Base UI's, loaded on demand by menu.tsx. */
export default function MenuPopup(props: MenuPopupProps): React.JSX.Element {
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  // The stand-in pressed to load this has gone, taking keyboard focus with it.
  // Focus the real button first, so the menu takes focus from it and gives it
  // back there on closing. Before paint, so focus is never lost to the page.
  React.useLayoutEffect(() => {
    triggerRef.current?.focus();
  }, []);

  return (
    <BaseMenu.Root defaultOpen>
      <BaseMenu.Trigger
        ref={triggerRef}
        aria-label={props.triggerLabel}
        className={props.triggerClassName}
      >
        {props.trigger}
      </BaseMenu.Trigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner
          className="z-50 outline-none"
          side={props.side ?? "bottom"}
          align={props.align ?? "end"}
          sideOffset={6}
        >
          <BaseMenu.Popup className="bg-card text-card-foreground shadow-card max-h-[var(--available-height)] min-w-52 overflow-y-auto rounded-xl border py-1 outline-none">
            {props.items.map((entry) => (
              <MenuItem
                key={entry.kind === "separator" ? entry.key : entry.label}
                entry={entry}
                linkComponent={props.linkComponent}
              />
            ))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
