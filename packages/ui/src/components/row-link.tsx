import { useRender } from "@base-ui/react/use-render";
import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Whole-row links (6 Nov 2026 look): a row of a list or table opens its main
 * thing (the rental, say) from anywhere on it, while the names and regos in
 * it are links of their own (to the Renter, the car).
 *
 * The row's main link is stretched over the row by a pseudo-element, so no
 * link sits inside another (which HTML forbids and screen readers garble):
 *
 * ```tsx
 * <li className={ROW_CLASSES}>
 *   <InlineRecordLink asChild><Link href={renterPath(id)}>Sam Patel</Link></InlineRecordLink>
 *   <RowLink asChild><Link href={rentalPath(id)} aria-label="Sam Patel's rental">Back today</Link></RowLink>
 * </li>
 * ```
 *
 * The row needs `ROW_CLASSES` (position: relative) and exactly one RowLink.
 * Give the RowLink an `aria-label` that names the whole row when its own
 * words alone don't (e.g. "Handover to Jamie Park" for "Handover to").
 * Works on `<tr>` too.
 */
export const ROW_CLASSES = "relative transition-colors hover:bg-muted/60";

const ROW_LINK_CLASSES =
  // The stretched layer carries the focus ring, so the whole row shows it.
  "outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] hover:text-primary focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset";

/** Bold teal, navy on hover and keyboard focus; never underlined (Abhi, 7 Nov 2026). Above the row's stretched link. */
const INLINE_LINK_TONE_CLASSES = {
  teal: "text-teal hover:text-primary focus-visible:text-primary",
  /** On the navy strip: white, light teal on hover and focus. */
  onPrimary:
    "text-primary-foreground hover:text-on-primary-label focus-visible:text-on-primary-label",
} as const;

// w-fit: as a flex item (a name on its own line) it must not stretch across
// the row, or it would cover the space that opens the row's main link.
const INLINE_LINK_CLASSES =
  "relative z-10 w-fit rounded-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring";

interface LinkPieceProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** With `asChild`, the one element inside (Next's Link, say) is drawn as the link. */
  asChild?: boolean;
}

function useLinkElement(
  { asChild = false, children, ...props }: LinkPieceProps,
  className: string,
): React.ReactElement {
  const childElement = asChild && React.isValidElement(children) ? children : undefined;
  return useRender({
    defaultTagName: "a",
    render: childElement,
    props: childElement ? { ...props, className } : { ...props, className, children },
  });
}

/** The row's main link: opens the row's main thing from anywhere on the row. */
export function RowLink({ className, ...props }: LinkPieceProps): React.ReactElement {
  return useLinkElement(props, cn(ROW_LINK_CLASSES, className));
}

export interface InlineRecordLinkProps extends LinkPieceProps {
  tone?: keyof typeof INLINE_LINK_TONE_CLASSES;
  /**
   * Phones get one tap per row (rule 34): below tablet width the name is
   * plain bold text, so a tap anywhere opens the row's main link. Set this
   * where there is no row link to fall back on, so the name stays a link.
   */
  isLinkOnPhones?: boolean;
}

/**
 * A name or rego that opens its own record: bold teal, navy on hover.
 *
 * Below tablet width (unless `isLinkOnPhones`), the link is hidden
 * (display: none, so neither seen, tapped nor read out) and the same words
 * show as plain bold text instead. That is cleaner than a link made
 * untappable with pointer-events, which a screen reader would still offer
 * as a link to the Renter while opening the rental. The words are in the
 * page twice, one copy hidden, so browser tests find the link by role.
 */
export function InlineRecordLink({
  tone = "teal",
  isLinkOnPhones = false,
  className,
  ...props
}: InlineRecordLinkProps): React.JSX.Element {
  const link = useLinkElement(
    props,
    cn(
      INLINE_LINK_CLASSES,
      INLINE_LINK_TONE_CLASSES[tone],
      !isLinkOnPhones && "hidden md:inline",
      className,
    ),
  );
  if (isLinkOnPhones) {
    return link;
  }
  const words = React.isValidElement<{ children?: React.ReactNode }>(props.children)
    ? props.children.props.children
    : props.children;
  return (
    <>
      {link}
      <span className={cn("font-bold md:hidden", className)}>{words}</span>
    </>
  );
}
