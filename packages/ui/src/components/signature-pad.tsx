"use client";

import { Eraser } from "lucide-react";
import * as React from "react";
import SignaturePadDrawing from "signature_pad";

import { cn } from "../lib/utils";
import { Button } from "./button";
import { fieldLabelId } from "./form-field";

/** Dark ink on a white pad whatever the theme, so it prints as signed. */
const INK_COLOUR = "#111827";
const PAD_HEIGHT_PX = 176;
const PNG_TYPE = "image/png";

export interface SignaturePadProps {
  id: string;
  /** The form field that receives the drawing as a PNG data URL ("" until drawn). */
  name: string;
  onValueChange?: (value: string) => void;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

/** Fits the canvas to its box at the screen's sharpness, keeping what is drawn. */
function fitCanvas(canvas: HTMLCanvasElement, drawing: SignaturePadDrawing): void {
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  const strokes = drawing.toData();
  canvas.width = canvas.offsetWidth * ratio;
  canvas.height = canvas.offsetHeight * ratio;
  canvas.getContext("2d")?.scale(ratio, ratio);
  drawing.clear();
  drawing.fromData(strokes);
}

/**
 * A box to sign in with a finger, pen or mouse (signature_pad). The drawing
 * goes to the form as a PNG in a hidden field. Drawing needs a pointer, so
 * a form using this always offers typing a name as well (WCAG 2.1.1).
 */
export function SignaturePad({
  id,
  name,
  onValueChange,
  ...aria
}: SignaturePadProps): React.JSX.Element {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const drawingRef = React.useRef<SignaturePadDrawing | null>(null);
  const [value, setValue] = React.useState("");
  // Kept in a ref so a screen passing a new function each time it redraws
  // never makes the pad start again, which wiped every stroke but the last
  // (review A10-1).
  const onValueChangeRef = React.useRef(onValueChange);
  React.useEffect(() => {
    onValueChangeRef.current = onValueChange;
  }, [onValueChange]);

  const changeValue = React.useCallback((next: string) => {
    setValue(next);
    onValueChangeRef.current?.(next);
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const drawing = new SignaturePadDrawing(canvas, { penColor: INK_COLOUR });
    drawingRef.current = drawing;
    const handleEndStroke = (): void => changeValue(drawing.toDataURL(PNG_TYPE));
    drawing.addEventListener("endStroke", handleEndStroke);
    const resizeWatcher = new ResizeObserver(() => fitCanvas(canvas, drawing));
    resizeWatcher.observe(canvas);
    return () => {
      resizeWatcher.disconnect();
      drawing.removeEventListener("endStroke", handleEndStroke);
      drawing.off();
      drawingRef.current = null;
    };
  }, [changeValue]);

  const handleClear = (): void => {
    drawingRef.current?.clear();
    changeValue("");
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        id={id}
        role="img"
        aria-labelledby={fieldLabelId(id)}
        aria-describedby={aria["aria-describedby"]}
        aria-invalid={aria["aria-invalid"] || undefined}
        style={{ height: PAD_HEIGHT_PX }}
        className={cn(
          "border-input block w-full touch-none rounded-md border-2 border-dashed bg-white",
          aria["aria-invalid"] && "border-destructive",
        )}
      />
      <Button type="button" variant="outline" onClick={handleClear} disabled={value === ""}>
        <Eraser aria-hidden="true" />
        Clear signature
      </Button>
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
