"use client";

import { describeErrorForLog } from "@fleetapp/core";
import { Search } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";
import { buttonVariants } from "./button";
import { Input } from "./input";

/** One thing found: a link to its page, with a line that tells similar ones apart. */
export interface QuickSearchResult {
  key: string;
  href: string;
  title: string;
  detail: string;
}

/** Results of one kind, e.g. "Cars". */
export interface QuickSearchGroup {
  label: string;
  items: readonly QuickSearchResult[];
}

/**
 * An app's own link component (Next's Link), so moving between pages stays
 * in the app. `replace` opens the page in place of the current history step.
 */
export type QuickSearchLinkComponent = React.ComponentType<{
  href: string;
  replace?: boolean;
  className?: string;
  children?: React.ReactNode;
}>;

export interface QuickSearchProps {
  /** The box's spoken name, e.g. "Search". */
  label: string;
  placeholder: string;
  /** What matches the typed text (already trimmed), grouped. Only empty groups are left out. */
  search: (text: string) => Promise<readonly QuickSearchGroup[]>;
  /** Nothing is searched for until this many characters are typed. */
  minimumLength: number;
  /** The box takes no more than this. */
  maximumLength: number;
  /** Draws result links; a plain link (a full page load) unless given. */
  linkComponent?: QuickSearchLinkComponent;
}

/** A soft fill and a thin outline that still stands out (WCAG 1.4.11): the look agreed for the top bar. */
export const QUICK_SEARCH_BOX_CLASSES = "bg-muted pl-10 shadow-none";
/** About 340px on a computer (Abhi, 6 Nov 2026), and the sheet's full width on a phone. */
export const QUICK_SEARCH_WIDTH_CLASSES = "w-full md:w-85";
export const QUICK_SEARCH_PHONE_BUTTON_CLASSES = cn(
  buttonVariants({ variant: "ghost", size: "icon" }),
  "text-primary rounded-full [&_svg]:size-5",
);

/** The magnifying glass inside the box. */
export function QuickSearchIcon(): React.JSX.Element {
  return (
    <Search
      aria-hidden
      className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2"
    />
  );
}

type PopupModule = typeof import("./quick-search-popup");

// The search itself (Base UI's Autocomplete and Dialog, and their positioning)
// is loaded only when wanted: it sits in the top bar of every page, and most
// visits never search.
function loadQuickSearchPopup(): Promise<PopupModule> {
  return import("./quick-search-popup");
}

/** A lost connection only leaves the stand-in in place: focusing it again tries again. */
function logLoadFailure(error: unknown): void {
  console.warn("The search did not load", describeErrorForLog(error));
}

function preloadQuickSearch(): void {
  loadQuickSearchPopup().catch(logLoadFailure);
}

interface LoadedBox {
  Field: PopupModule["QuickSearchField"];
  isFocused: boolean;
}

/** The computer's box: a stand-in that looks the same until it is focused. */
function QuickSearchBox(props: QuickSearchProps): React.JSX.Element {
  // Kept after the stand-in leaves the page (React would empty an ordinary
  // ref then), so the real box can take over what was typed in it.
  const standIn = React.useRef<HTMLInputElement | null>(null);
  const keepStandIn = React.useCallback((element: HTMLInputElement | null) => {
    if (element) {
      standIn.current = element;
    }
  }, []);
  const [loaded, setLoaded] = React.useState<LoadedBox | null>(null);

  function handleWanted(): void {
    loadQuickSearchPopup()
      .then((popup) => {
        setLoaded({
          Field: popup.QuickSearchField,
          isFocused: document.activeElement === standIn.current,
        });
      })
      .catch(logLoadFailure);
  }

  if (loaded) {
    return <loaded.Field {...props} standIn={standIn} shouldFocus={loaded.isFocused} />;
  }
  return (
    <div className={cn("relative", QUICK_SEARCH_WIDTH_CLASSES)}>
      <QuickSearchIcon />
      <Input
        ref={keepStandIn}
        role="combobox"
        aria-expanded={false}
        aria-autocomplete="list"
        aria-label={props.label}
        placeholder={props.placeholder}
        maxLength={props.maximumLength}
        autoComplete="off"
        enterKeyHint="search"
        className={QUICK_SEARCH_BOX_CLASSES}
        onPointerEnter={preloadQuickSearch}
        onFocus={handleWanted}
      />
    </div>
  );
}

/** The phone's search button: a stand-in until pressed, then the button that opens the sheet. */
function QuickSearchButton(props: QuickSearchProps): React.JSX.Element {
  const [Sheet, setSheet] = React.useState<PopupModule["QuickSearchSheet"] | null>(null);

  function handlePress(): void {
    loadQuickSearchPopup()
      .then((popup) => setSheet(() => popup.QuickSearchSheet))
      .catch(logLoadFailure);
  }

  if (Sheet) {
    return <Sheet {...props} />;
  }
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-haspopup="dialog"
      className={QUICK_SEARCH_PHONE_BUTTON_CLASSES}
      onPointerEnter={preloadQuickSearch}
      onFocus={preloadQuickSearch}
      onClick={handlePress}
    >
      <Search aria-hidden />
    </button>
  );
}

/**
 * Search as you type, for a top bar: results appear a moment after typing
 * stops, grouped by kind (Cars, Renters, Rentals), each a link to its page.
 * Built on Base UI's Autocomplete, read out as a combobox with a list:
 * arrows move through the results, Enter opens one, Escape closes the list.
 *
 * On a computer it is a box; on a phone a search button (a fingertip wide)
 * that opens the same search across the top of the screen, box focused.
 * Until first focused or pressed, both are stand-ins that look the same, so
 * the search's code loads only when wanted.
 */
export function QuickSearch(props: QuickSearchProps): React.JSX.Element {
  return (
    <>
      <div className="hidden md:block">
        <QuickSearchBox {...props} />
      </div>
      <div className="md:hidden">
        <QuickSearchButton {...props} />
      </div>
    </>
  );
}
