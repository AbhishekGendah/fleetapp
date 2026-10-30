"use client";

import { useRef } from "react";

import { Button, type ButtonProps } from "./button";

interface FilePickerProps {
  /** On the button, e.g. "Add photos". */
  label: string;
  /** The file types offered, e.g. "image/jpeg,image/png". */
  accept: string;
  /** Several at once, e.g. photos from the gallery. */
  isMultiple?: boolean;
  isDisabled?: boolean;
  variant?: ButtonProps["variant"];
  /** Before the label, e.g. a paperclip for Attach. */
  icon?: React.ReactNode;
  onFilesChosen(files: File[]): void;
}

/**
 * A button that opens the phone's camera and gallery (or the computer's
 * files). Choosing the same file again still counts, as the box is emptied
 * after each choice.
 */
export function FilePicker(props: FilePickerProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        type="button"
        variant={props.variant ?? "outline"}
        className="sm:self-start"
        disabled={props.isDisabled}
        onClick={() => inputRef.current?.click()}
      >
        {props.icon}
        {props.label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={props.accept}
        multiple={props.isMultiple}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const chosen = [...(event.target.files ?? [])];
          event.target.value = "";
          if (chosen.length > 0) {
            props.onFilesChosen(chosen);
          }
        }}
      />
    </>
  );
}
