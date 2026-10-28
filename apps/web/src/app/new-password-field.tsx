import { fieldErrorId, FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";

/** One of the two "choose a password" boxes, on the invite and reset pages. */
export function NewPasswordField(props: {
  name: "password" | "confirmation";
  label: string;
  errors?: string[];
}) {
  const error = props.errors?.join(" ");
  return (
    <FormField htmlFor={props.name} label={props.label} isRequired error={error}>
      <Input
        id={props.name}
        name={props.name}
        type="password"
        autoComplete="new-password"
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? fieldErrorId(props.name) : undefined}
      />
    </FormField>
  );
}
