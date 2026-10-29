import { AUSTRALIAN_STATE_CODES } from "@fleetapp/core";

/** The options for a state dropdown: "Choose…", then every state and territory. */
export function AustralianStateOptions() {
  return (
    <>
      <option value="">Choose…</option>
      {AUSTRALIAN_STATE_CODES.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </>
  );
}
