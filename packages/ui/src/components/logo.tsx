import markImage from "../assets/logo-mark.svg";
import wordmarkImage from "../assets/logo-wordmark.svg";
import { BRAND } from "../brand";
import { cn } from "../lib/utils";

/**
 * The emblem alone, for tight spaces: the phone header, small badges.
 * Decorative wherever the product name is also on screen.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    // A plain img: the emblem is already a tiny vector file, nothing for
    // next/image to optimise, and this package is not tied to Next's image API.
    <img src={markImage.src} alt="" aria-hidden className={cn("h-8 w-auto shrink-0", className)} />
  );
}

/**
 * The full logo: emblem and the drawn wordmark. The wordmark is a picture of
 * the product name, so its text alternative carries the name from the brand
 * file for screen readers. Swapping both files renames the logo.
 */
export function Logo(props: { className?: string; label?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", props.className)}>
      <LogoMark />
      <img src={wordmarkImage.src} alt={BRAND.productName} className="h-3.5 w-auto" />
      {props.label ? (
        <span className="bg-primary-soft text-teal rounded-full px-2 py-0.5 text-xs font-semibold">
          {props.label}
        </span>
      ) : null}
    </span>
  );
}
