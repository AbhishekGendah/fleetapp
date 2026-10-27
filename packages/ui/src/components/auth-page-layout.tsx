import { Logo } from "./logo";

/**
 * The frame for every page used before or around signing in: the logo, then
 * one card, centred. `label` marks the admin app's pages ("Admin") so the
 * two apps cannot be mistaken for each other.
 */
export function AuthPageLayout(props: { label?: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-4">
      <Logo label={props.label} className="justify-center" />
      {props.children}
    </main>
  );
}
