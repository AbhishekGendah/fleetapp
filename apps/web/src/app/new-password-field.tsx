import { FormError } from "@fleetapp/ui/form-message";
import { Input, Label } from "@fleetapp/ui/input";

/** One of the two "choose a password" boxes, on the invite and reset pages. */
export function NewPasswordField(props: {
  name: "password" | "confirmation";
  label: string;
  errors?: string[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={props.name}>{props.label}</Label>
      <Input
        id={props.name}
        name={props.name}
        type="password"
        autoComplete="new-password"
        required
        aria-invalid={props.errors ? true : undefined}
      />
      {props.errors ? <FormError message={props.errors.join(" ")} /> : null}
    </div>
  );
}
