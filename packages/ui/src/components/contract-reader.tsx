import type { JSONContent } from "@tiptap/core";
import { renderToReactElement } from "@tiptap/static-renderer/pm/react";
import type * as React from "react";

import { cn } from "../lib/utils";
import { CONTRACT_TEXT_CLASSES, contractTextKit } from "./contract-text";

export interface ContractReaderProps {
  /** The filled contract (every merge field already replaced by its text). */
  content: JSONContent;
  /** Names the contract for screen readers, e.g. "Rental contract". */
  label: string;
}

/**
 * A filled contract shown as plain page text, in full, for the Renter to
 * read before signing. Rendered on the server from the same text rules as
 * the editor, so no editor code reaches the phone.
 */
export function ContractReader({ content, label }: ContractReaderProps): React.JSX.Element {
  return (
    <article aria-label={label} className="bg-card rounded-md border px-4 py-3">
      <div className={cn(CONTRACT_TEXT_CLASSES, "break-words")}>
        {renderToReactElement({ content, extensions: [contractTextKit] })}
      </div>
      <p className="text-muted-foreground mt-6 border-t pt-3 text-center text-sm">
        End of contract
      </p>
    </article>
  );
}
