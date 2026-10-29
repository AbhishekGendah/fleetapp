import { FormField } from "./form-field";
import { Input } from "./input";

/** The box for a password the person already has (signing in, confirming it's them). */
export function CurrentPasswordField(props: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <FormField htmlFor="password" label={props.label} isRequired>
      <Input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        value={props.value}
        onChange={(event) => props.onValueChange(event.target.value)}
      />
    </FormField>
  );
}
