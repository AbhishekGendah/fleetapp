"use client";

import { Menu as BaseMenu } from "@base-ui/react/menu";
import * as React from "react";

import { cn } from "../lib/utils";
import { buttonVariants } from "./button";

/** Every item is a full-width row at least 44px tall (rule 24). */
const ITEM_CLASSES =
  "flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 text-left text-sm font-semibold text-foreground outline-none select-none data-[highlighted]:bg-muted data-[disabled]:cursor-default data-[disabled]:opacity-50 [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

/** The page being shown is marked in teal, as in the side menu. */
const CURRENT_ITEM_CLASSES = "text-teal font-bold [&_svg]:text-teal";

export interface MenuProps {
  /** What the trigger shows: text, an icon, or an initial. */
  trigger: React.ReactNode;
  /** The trigger's spoken name, when what it shows is not words (e.g. "Account menu"). */
  triggerLabel?: string;
  /** How the trigger looks; an outline button unless given. */
  triggerClassName?: string;
  /** Which side of the trigger the menu opens on: below it, or above (a bar at the bottom). */
  side?: "top" | "bottom";
  /** Which edge of the trigger the menu lines up with. */
  align?: "start" | "center" | "end";
  /** MenuLinkItem, MenuButtonItem and MenuSeparator. */
  children: React.ReactNode;
}

/**
 * A button that opens a short list of choices: links to other pages, or
 * actions. Built on Base UI's Menu, so it opens with Enter, Space or the
 * arrow keys, arrows move between items, typing a letter jumps to an item,
 * and Escape closes it and returns focus to the button.
 */
export function Menu(props: MenuProps): React.JSX.Element {
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger
        aria-label={props.triggerLabel}
        className={props.triggerClassName ?? buttonVariants({ variant: "outline" })}
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
            {props.children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

export interface MenuLinkItemProps {
  /** Where it goes; with `asChild`, the link inside says instead. */
  href?: string;
  /** Marks the item as the page being shown. */
  isCurrent?: boolean;
  /**
   * With `asChild`, the one element inside (an app's own link, such as
   * Next's Link) is drawn as the item, so moving between pages stays in the app.
   */
  asChild?: boolean;
  children: React.ReactNode;
}

/** A choice that opens another page. Closes the menu as it goes. */
export function MenuLinkItem(props: MenuLinkItemProps): React.JSX.Element {
  const childElement =
    props.asChild && React.isValidElement(props.children) ? props.children : undefined;
  return (
    <BaseMenu.LinkItem
      href={props.href}
      closeOnClick
      aria-current={props.isCurrent ? "page" : undefined}
      className={cn(ITEM_CLASSES, props.isCurrent && CURRENT_ITEM_CLASSES)}
      render={childElement}
    >
      {childElement ? undefined : props.children}
    </BaseMenu.LinkItem>
  );
}

export interface MenuButtonItemProps {
  onSelect: () => void;
  isDisabled?: boolean;
  children: React.ReactNode;
}

/** A choice that does something here, such as Sign out. Closes the menu first. */
export function MenuButtonItem(props: MenuButtonItemProps): React.JSX.Element {
  return (
    <BaseMenu.Item className={ITEM_CLASSES} disabled={props.isDisabled} onClick={props.onSelect}>
      {props.children}
    </BaseMenu.Item>
  );
}

/** A thin line between groups of choices, e.g. before Sign out. */
export function MenuSeparator(): React.JSX.Element {
  return <BaseMenu.Separator className="my-1 border-t" />;
}
