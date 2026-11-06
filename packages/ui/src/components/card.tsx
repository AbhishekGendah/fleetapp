import * as React from "react";

import { cn } from "../lib/utils";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        // A transparent border keeps the card's edge in Windows high-contrast mode.
        "bg-card text-card-foreground shadow-card rounded-2xl border border-transparent",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1.5 p-4 sm:p-6", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn("text-primary text-lg leading-tight font-bold tracking-tight", className)}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-muted-foreground text-sm", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-4 pt-0 sm:p-6 sm:pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-center p-4 pt-0 sm:p-6 sm:pt-0", className)}
      {...props}
    />
  ),
);
CardFooter.displayName = "CardFooter";

/** The small capitals that name a card's section (6 Nov 2026 look). */
export const SECTION_LABEL_CLASSES = "text-xs font-extrabold tracking-[0.08em] uppercase";

interface SectionLabelProps extends React.HTMLAttributes<HTMLElement> {
  /** A heading where it starts a section of the page; a span where it only labels a value. */
  as?: "h2" | "h3" | "span";
}

/**
 * A card's section name in small grey capitals, e.g. "Needs attention".
 * Type it in ordinary case: the capitals are only the look, so screen
 * readers say it as words rather than spelling it out.
 */
function SectionLabel({ as: Tag = "h2", className, ...props }: SectionLabelProps) {
  return (
    <Tag className={cn("text-muted-foreground", SECTION_LABEL_CLASSES, className)} {...props} />
  );
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, SectionLabel };
