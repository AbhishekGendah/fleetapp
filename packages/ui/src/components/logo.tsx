import { BRAND } from "../brand";
import { cn } from "../lib/utils";

/**
 * The placeholder logo: a mark and the product name. The real logo replaces
 * this one component.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg text-base font-bold",
        className,
      )}
    >
      {BRAND.logoMark}
    </span>
  );
}

export function Logo(props: { className?: string; label?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", props.className)}>
      <LogoMark />
      <span className="text-primary text-lg font-bold">{BRAND.productName}</span>
      {props.label ? (
        <span className="bg-primary-soft text-primary-dark rounded-full px-2 py-0.5 text-xs font-semibold">
          {props.label}
        </span>
      ) : null}
    </span>
  );
}
