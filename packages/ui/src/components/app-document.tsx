import type * as React from "react";

import { QueryAdapter } from "./query-adapter";

/** The page itself, the same in both apps: Australian English, the brand font, the address-bar state for lists. */
export function AppDocument(props: {
  fontClassName: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <html lang="en-AU" className={props.fontClassName}>
      <body>
        <QueryAdapter>{props.children}</QueryAdapter>
      </body>
    </html>
  );
}
