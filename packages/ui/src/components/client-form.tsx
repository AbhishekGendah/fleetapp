"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { Button, type ButtonProps } from "./button";

const HydrationContext = createContext(false);

/**
 * A form that is handled in the browser, safe to click before the page has
 * finished loading.
 *
 * Until the page's code has loaded, a form falls back to the browser's own
 * submit, which by default reloads the page with every field in the address
 * bar: an email and password included, into the browser history. So the form
 * posts instead (nothing typed goes in the address), and its submit button
 * stays disabled until the code is ready. A disabled submit button also stops
 * Enter in a field from submitting.
 */
export function ClientForm(props: {
  onSubmit(event: React.FormEvent<HTMLFormElement>): void | Promise<void>;
  className?: string;
  children: React.ReactNode;
}) {
  const [hasHydrated, setHasHydrated] = useState(false);
  useEffect(() => setHasHydrated(true), []);

  return (
    <HydrationContext.Provider value={hasHydrated}>
      <form method="post" className={props.className} onSubmit={props.onSubmit}>
        {props.children}
      </form>
    </HydrationContext.Provider>
  );
}

/** The submit button for a ClientForm: disabled until the page can handle it. */
export function SubmitButton({ disabled, ...props }: Omit<ButtonProps, "type">) {
  const hasHydrated = useContext(HydrationContext);
  return <Button {...props} type="submit" disabled={!hasHydrated || disabled} />;
}
