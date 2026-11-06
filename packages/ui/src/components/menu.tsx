"use client";

import * as React from "react";

import { buttonVariants } from "./button";

/** One choice in a Menu: a link to another page, something to do here, or a dividing line. */
export type MenuEntry =
  | {
      kind: "link";
      label: string;
      href: string;
      icon?: React.ReactNode;
      /** Marks the item as the page being shown. */
      isCurrent?: boolean;
    }
  | {
      kind: "action";
      label: string;
      onSelect: () => void;
      icon?: React.ReactNode;
      isDisabled?: boolean;
    }
  | { kind: "separator"; key: string };

/** An app's own link component (Next's Link), so moving between pages stays in the app. */
export type MenuLinkComponent = React.ComponentType<{
  href: string;
  className?: string;
  children?: React.ReactNode;
}>;

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
  items: readonly MenuEntry[];
  /** Draws link items; a plain link (a full page load) unless given. */
  linkComponent?: MenuLinkComponent;
}

/** The loaded menu opens as soon as it appears: it was loaded by pressing the trigger. */
export interface MenuPopupProps extends MenuProps {
  triggerClassName: string;
}

// The menu itself (Base UI and its positioning) is loaded only when wanted:
// it sits in the frame of every page, and most visits never open it.
function loadMenuPopup(): Promise<{ default: React.ComponentType<MenuPopupProps> }> {
  return import("./menu-popup");
}
const MenuPopup = React.lazy(loadMenuPopup);

/**
 * A button that opens a short list of choices: links to other pages, or
 * actions. Built on Base UI's Menu, so it opens with Enter, Space or the
 * arrow keys, arrows move between items, typing a letter jumps to an item,
 * and Escape closes it and returns focus to the button.
 *
 * Until first first pressed, the button is a stand-in that looks the same. Its
 * code starts loading when the button is pointed at or focused, and the
 * press opens the menu as soon as it has.
 */
export function Menu(props: MenuProps): React.JSX.Element {
  const [isWanted, setIsWanted] = React.useState(false);
  const triggerClassName = props.triggerClassName ?? buttonVariants({ variant: "outline" });

  const standIn = (
    <button
      type="button"
      aria-haspopup="menu"
      aria-expanded={false}
      aria-label={props.triggerLabel}
      className={triggerClassName}
      onPointerEnter={() => void loadMenuPopup()}
      onFocus={() => void loadMenuPopup()}
      onClick={() => setIsWanted(true)}
    >
      {props.trigger}
    </button>
  );

  if (!isWanted) {
    return standIn;
  }
  return (
    <React.Suspense fallback={standIn}>
      <MenuPopup {...props} triggerClassName={triggerClassName} />
    </React.Suspense>
  );
}
