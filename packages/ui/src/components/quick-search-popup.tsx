"use client";

import { Autocomplete } from "@base-ui/react/autocomplete";
import { Dialog } from "@base-ui/react/dialog";
import { describeErrorForLog } from "@fleetapp/core";
import { Search } from "lucide-react";
import * as React from "react";

import { SEARCH_AS_YOU_TYPE_DELAY_MS } from "../lib/typing-pause";
import { useCloseOnBack } from "../lib/use-close-on-back";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { SECTION_LABEL_CLASSES } from "./card";
import { Input } from "./input";
import {
  QUICK_SEARCH_BOX_CLASSES,
  QUICK_SEARCH_PHONE_BUTTON_CLASSES,
  QUICK_SEARCH_WIDTH_CLASSES,
  QuickSearchIcon,
  type QuickSearchGroup,
  type QuickSearchProps,
  type QuickSearchResult,
} from "./quick-search";

/**
 * Every result is a full-width row at least 44px tall (rule 24); its name bold
 * teal, underlined when pointed at. One from older text, while the newer is
 * being found, is faded and cannot be opened.
 */
const RESULT_CLASSES =
  "group flex min-h-11 cursor-pointer flex-col justify-center px-4 py-2 outline-none select-none transition-opacity data-[highlighted]:bg-primary-soft data-[disabled]:cursor-default data-[disabled]:opacity-60";

interface FoundGroups {
  groups: readonly QuickSearchGroup[];
  isSearching: boolean;
}

/** A lost connection only means no results: the box still works. The typed text is never logged. */
function logSearchFailure(error: unknown): void {
  console.warn("The search did not answer", describeErrorForLog(error));
}

/**
 * Results for the typed text, asked for after a pause in typing. The last
 * results stay in view while the next are found, so the list does not
 * flicker on each key, but `isSearching` marks them as older text's: they
 * must not be opened then (a quick arrow and Enter would open a result the
 * current text never found). An answer for older text is never shown.
 */
function useFoundGroups(
  search: QuickSearchProps["search"],
  text: string,
  minimumLength: number,
): FoundGroups {
  const [found, setFound] = React.useState<{
    text: string;
    groups: readonly QuickSearchGroup[];
  }>({ text: "", groups: [] });

  React.useEffect(() => {
    if (text.length < minimumLength) {
      return;
    }
    let isCurrent = true;
    const timer = setTimeout(() => {
      search(text)
        .catch((error: unknown) => {
          logSearchFailure(error);
          return [];
        })
        .then((groups) => {
          if (isCurrent) {
            setFound({ text, groups });
          }
        });
    }, SEARCH_AS_YOU_TYPE_DELAY_MS);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [search, text, minimumLength]);

  if (text.length < minimumLength) {
    return { groups: [], isSearching: false };
  }
  return { groups: found.groups, isSearching: found.text !== text };
}

interface ResultListProps {
  /** Found for older text, while the current text's are found: shown, but not opened. */
  isStale: boolean;
  linkComponent: QuickSearchProps["linkComponent"];
  /** Opens results in place of the current history step: the sheet's own, which back would only reopen. */
  shouldReplaceStep: boolean;
  /** A result was opened (by a tap, a click or Enter): its own link goes to its page. */
  onOpened: (href: string) => void;
}

function ResultLink({
  result,
  isStale,
  linkComponent: LinkComponent,
  shouldReplaceStep,
  onOpened,
}: ResultListProps & { result: QuickSearchResult }): React.JSX.Element {
  return (
    <Autocomplete.Item
      value={result}
      // Disabled, a click or Enter (which clicks the highlighted link) is refused before
      // the link sees it, and the arrows pass it by.
      disabled={isStale}
      className={RESULT_CLASSES}
      onClick={() => onOpened(result.href)}
      render={
        LinkComponent ? (
          <LinkComponent href={result.href} replace={shouldReplaceStep} />
        ) : (
          <a href={result.href} />
        )
      }
    >
      <span className="text-teal font-bold decoration-2 underline-offset-[3px] group-hover:underline">
        {result.title}
      </span>
      {result.detail ? (
        <span className="text-muted-foreground text-sm">{result.detail}</span>
      ) : null}
    </Autocomplete.Item>
  );
}

function ResultList({
  text,
  found,
  minimumLength,
  ...linkProps
}: Omit<ResultListProps, "isStale"> & {
  text: string;
  found: FoundGroups;
  minimumLength: number;
}): React.JSX.Element {
  const emptyMessage = found.isSearching ? "Searching…" : `No matches for “${text}”`;
  return (
    <>
      <Autocomplete.Empty className="text-muted-foreground px-4 text-sm empty:hidden">
        {text.length >= minimumLength ? <p className="py-3">{emptyMessage}</p> : null}
      </Autocomplete.Empty>
      <Autocomplete.List className="outline-none">
        {(group: QuickSearchGroup) => (
          <Autocomplete.Group key={group.label} items={group.items} className="py-1">
            <Autocomplete.GroupLabel
              className={cn("text-muted-foreground px-4 pt-2 pb-1", SECTION_LABEL_CLASSES)}
            >
              {group.label}
            </Autocomplete.GroupLabel>
            <Autocomplete.Collection>
              {(result: QuickSearchResult) => (
                <ResultLink
                  key={result.key}
                  result={result}
                  isStale={found.isSearching}
                  {...linkProps}
                />
              )}
            </Autocomplete.Collection>
          </Autocomplete.Group>
        )}
      </Autocomplete.List>
    </>
  );
}

interface QuickSearchFieldProps extends QuickSearchProps {
  /** The stand-in this replaced: what was typed in it is carried over. */
  standIn?: React.RefObject<HTMLInputElement | null>;
  /** Takes the focus as it appears: the stand-in had it. */
  shouldFocus: boolean;
  /** In the phone's sheet: the results sit under the box rather than in a pop-up. */
  isInSheet?: boolean;
  /** A result was opened (its address given), in the sheet. */
  onFinished?: (href: string) => void;
  /** Next to the box, e.g. the sheet's Close button. */
  besideBox?: React.ReactNode;
}

/** The search box once wanted: Base UI's Autocomplete, loaded on demand by quick-search.tsx. */
export function QuickSearchField({
  standIn,
  shouldFocus,
  isInSheet = false,
  onFinished,
  besideBox,
  ...props
}: QuickSearchFieldProps): React.JSX.Element {
  const [typed, setTyped] = React.useState("");
  const [isOpen, setIsOpen] = React.useState(true);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const text = typed.trim();
  const found = useFoundGroups(props.search, text, props.minimumLength);
  const hasEnoughText = text.length >= props.minimumLength;

  // The stand-in focused to load this has gone, taking keyboard focus with it.
  // Before paint, so focus is never lost to the page. What it holds is read
  // only now, as it leaves the page, so no key typed while this loaded is lost.
  React.useLayoutEffect(() => {
    const carried = standIn?.current?.value ?? "";
    if (carried !== "") {
      setTyped(carried);
    }
    if (shouldFocus) {
      inputRef.current?.focus();
    }
  }, [standIn, shouldFocus]);

  function handleOpened(href: string): void {
    // The box starts afresh for the next search.
    setTyped("");
    setIsOpen(false);
    onFinished?.(href);
  }

  const results = (
    <ResultList
      text={text}
      found={found}
      minimumLength={props.minimumLength}
      linkComponent={props.linkComponent}
      shouldReplaceStep={isInSheet}
      onOpened={handleOpened}
    />
  );

  // The list sits in the page under the box (Base UI's inline list) rather
  // than in a pop-up layer: a pop-up hides the rest of the page from screen
  // readers while open, links and all (axe: aria-hidden-focus).
  const isListShown = isInSheet || (isOpen && hasEnoughText);
  return (
    <Autocomplete.Root
      items={found.groups}
      // The server has already chosen what matches.
      filter={null}
      itemToStringValue={(result: QuickSearchResult) => result.title}
      inline
      open={isListShown}
      value={typed}
      onValueChange={(next) => {
        setTyped(next);
        setIsOpen(true);
      }}
      onOpenChange={setIsOpen}
    >
      <div className="flex items-center gap-2">
        <div className={cn("relative", QUICK_SEARCH_WIDTH_CLASSES, isInSheet && "min-w-0 flex-1")}>
          <QuickSearchIcon />
          <Autocomplete.Input
            ref={inputRef}
            aria-label={props.label}
            placeholder={props.placeholder}
            maxLength={props.maximumLength}
            enterKeyHint="search"
            // An inline list counts as always shown; this one is hidden when closed.
            aria-expanded={isListShown}
            onBlur={() => setIsOpen(false)}
            // An inline list is not closed by Escape itself; in the sheet, Escape closes the sheet.
            onKeyDown={(event) => {
              if (event.key === "Escape" && !isInSheet) {
                setIsOpen(false);
              }
            }}
            render={<Input autoComplete="off" className={QUICK_SEARCH_BOX_CLASSES} />}
          />
          {!isInSheet && isListShown ? (
            <div
              className="bg-card text-card-foreground shadow-card absolute inset-x-0 top-full z-50 mt-1.5 max-h-[min(32rem,70dvh)] overflow-y-auto rounded-xl border py-1"
              // Pressing inside the list (its scroll bar, a group label) keeps the box focused and the list open.
              onPointerDown={(event) => event.preventDefault()}
            >
              {results}
            </div>
          ) : null}
        </div>
        {besideBox}
      </div>
      {isInSheet ? (
        <div className="-mx-3 mt-2 min-h-0 flex-1 overflow-y-auto">{results}</div>
      ) : null}
    </Autocomplete.Root>
  );
}

function isThisPage(href: string): boolean {
  const opened = new URL(href, window.location.href);
  return opened.pathname === window.location.pathname && opened.search === window.location.search;
}

/**
 * The phone's search, once wanted: the search button, and the sheet it
 * opens across the top of the screen with the box focused. Base UI's Dialog
 * keeps focus inside while open and gives it back to the button on closing;
 * Escape, Close or the phone's back button closes it.
 */
export function QuickSearchSheet(props: QuickSearchProps): React.JSX.Element {
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  // It was loaded by pressing the button, so it opens at once.
  const [isOpen, setIsOpen] = React.useState(true);
  const close = React.useCallback(() => setIsOpen(false), []);
  useCloseOnBack(isOpen, close);

  // A result on another page leaves the sheet open: that page replaces this
  // one, sheet and all, and takes over the sheet's history step. Closing it
  // first would take that step back off and undo the move.
  function handleResultOpened(href: string): void {
    if (isThisPage(href)) {
      close();
    }
  }

  // The stand-in pressed to load this has gone: the real button takes the
  // focus first, so closing the sheet gives it back there.
  React.useLayoutEffect(() => {
    triggerRef.current?.focus();
  }, []);

  return (
    <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
      <Dialog.Trigger
        ref={triggerRef}
        aria-label={props.label}
        className={QUICK_SEARCH_PHONE_BUTTON_CLASSES}
      >
        <Search aria-hidden />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        {/* Opening focuses the first thing inside: the box. */}
        <Dialog.Popup className="bg-card text-card-foreground shadow-card fixed inset-x-0 top-0 z-50 flex max-h-dvh flex-col rounded-b-xl p-3 outline-none">
          <Dialog.Title className="sr-only">{props.label}</Dialog.Title>
          <QuickSearchField
            {...props}
            shouldFocus={false}
            isInSheet
            onFinished={handleResultOpened}
            besideBox={
              <Dialog.Close render={<Button type="button" variant="ghost" />}>Close</Dialog.Close>
            }
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
