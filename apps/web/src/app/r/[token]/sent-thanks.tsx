import { CardDescription } from "@fleetapp/ui/card";

/** After sending, and whenever the link is opened again until the Operator reviews it. Never what was sent. */
export function SentThanks(props: { operatorName: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-lg font-semibold">Thanks, {props.operatorName} will check your details.</p>
      <CardDescription>If anything needs changing, they will let you know.</CardDescription>
    </div>
  );
}
