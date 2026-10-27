import markImage from "../assets/pintofleet-mark.svg";
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
 * The full logo: emblem and name. The name is set in the wordmark font from
 * the brand file until there is a drawn PintoFleet wordmark to swap in here.
 */
export function Logo(props: { className?: string; label?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", props.className)}>
      <LogoMark />
      <span className="font-wordmark text-foreground text-[15px] tracking-wider uppercase">
        {BRAND.productName}
      </span>
      {props.label ? (
        <span className="bg-primary-soft text-teal rounded-full px-2 py-0.5 text-xs font-semibold">
          {props.label}
        </span>
      ) : null}
    </span>
  );
}
