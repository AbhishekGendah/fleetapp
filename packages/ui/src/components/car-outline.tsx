"use client";

import * as React from "react";

import { cn } from "../lib/utils";

/** Where a mark sits: across and down the outline, each from 0 to this. */
export const CAR_OUTLINE_SCALE = 1000;

export interface CarOutlineMark {
  id: string;
  x: number;
  y: number;
  /** Read out for the mark, e.g. "Damage 1: scratch on bonnet". */
  label: string;
}

export interface CarOutlineProps {
  marks: readonly CarOutlineMark[];
  /** A tap on the drawing, where it landed. Not given: the outline only shows its marks. */
  onPlace?: (position: { x: number; y: number }) => void;
  /** A mark pressed, e.g. to see or take its photo. */
  onSelectMark?: (markId: string) => void;
  /** Names the drawing for screen readers. */
  label: string;
  className?: string;
}

/** Where a tap landed, on the outline's own scale whatever the screen's size. */
function positionOf(event: React.MouseEvent<HTMLElement>): { x: number; y: number } {
  const box = event.currentTarget.getBoundingClientRect();
  const across = ((event.clientX - box.left) / box.width) * CAR_OUTLINE_SCALE;
  const down = ((event.clientY - box.top) / box.height) * CAR_OUTLINE_SCALE;
  const clamp = (value: number) => Math.round(Math.min(Math.max(value, 0), CAR_OUTLINE_SCALE));
  return { x: clamp(across), y: clamp(down) };
}

/** A car seen from above, front at the top: body, windows, wheels. */
function CarDrawing() {
  return (
    <svg
      viewBox={`0 0 ${CAR_OUTLINE_SCALE} ${CAR_OUTLINE_SCALE}`}
      className="h-full w-full"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" stroke="currentColor" strokeWidth="10" strokeLinejoin="round">
        <rect x="290" y="40" width="420" height="920" rx="140" />
        <path d="M330 330 Q500 280 670 330 L640 420 Q500 395 360 420 Z" />
        <path d="M360 700 Q500 725 640 700 L665 780 Q500 815 335 780 Z" />
        <line x1="290" y1="520" x2="710" y2="520" strokeDasharray="20 16" />
      </g>
      <g fill="currentColor">
        <rect x="245" y="170" width="45" height="120" rx="16" />
        <rect x="710" y="170" width="45" height="120" rx="16" />
        <rect x="245" y="710" width="45" height="120" rx="16" />
        <rect x="710" y="710" width="45" height="120" rx="16" />
      </g>
      <g fill="currentColor" fontSize="44" textAnchor="middle" fontFamily="sans-serif">
        <text x="500" y="30">
          Front
        </text>
        <text x="500" y="1000">
          Rear
        </text>
      </g>
    </svg>
  );
}

/**
 * The car outline that damage is marked on (docs/plans/phase-3.md, slice 5):
 * hand-built, as no maintained library draws a car to tap on. Tapping the
 * drawing places a mark; each mark is a numbered button. Tapping needs a
 * pointer, so a screen using this also offers choosing the area from a list.
 */
export function CarOutline({
  marks,
  onPlace,
  onSelectMark,
  label,
  className,
}: CarOutlineProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "text-muted-foreground relative mx-auto aspect-square w-full max-w-xs",
        className,
      )}
    >
      {onPlace ? (
        // Tapping is the quick way for a finger; the area list beside it is the keyboard's way.
        <div
          className="h-full w-full cursor-crosshair touch-manipulation"
          onClick={(event) => onPlace(positionOf(event))}
          role="img"
          aria-label={label}
        >
          <CarDrawing />
        </div>
      ) : (
        <div className="h-full w-full" role="img" aria-label={label}>
          <CarDrawing />
        </div>
      )}
      {marks.map((mark, index) => (
        <button
          key={mark.id}
          type="button"
          aria-label={mark.label}
          onClick={() => onSelectMark?.(mark.id)}
          className="bg-destructive text-destructive-foreground focus-visible:ring-ring absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm font-bold shadow focus-visible:ring-2 focus-visible:outline-none"
          style={{
            left: `${(mark.x / CAR_OUTLINE_SCALE) * 100}%`,
            top: `${(mark.y / CAR_OUTLINE_SCALE) * 100}%`,
          }}
        >
          {index + 1}
        </button>
      ))}
    </div>
  );
}
