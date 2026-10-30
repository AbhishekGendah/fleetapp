/** The admin app's own pages that other code sends people to. */
export const HOME_PATH = "/";
export const SIGN_IN_PATH = "/sign-in";
export const SET_UP_AUTHENTICATOR_PATH = "/set-up-authenticator";
export const OPERATORS_PATH = "/operators";
export const NEW_OPERATOR_PATH = `${OPERATORS_PATH}/new`;
/** Followed by /csv or /xlsx and the list's own query. */
export const OPERATORS_EXPORT_PATH = `${OPERATORS_PATH}/export`;
export const DEV_OUTBOX_PATH = "/dev-outbox";
export const COMPONENTS_PATH = "/components";

export function operatorPath(operatorId: string): string {
  return `${OPERATORS_PATH}/${operatorId}`;
}

export function devOutboxEmailPath(emailId: string): string {
  return `${DEV_OUTBOX_PATH}/${emailId}`;
}

/** The shared list of car makes and models every Operator's car form suggests from. */
export const CAR_MODELS_PATH = "/car-models";
export const TYPED_BY_OPERATORS_PATH = `${CAR_MODELS_PATH}/typed-by-operators`;

export function carMakePath(makeId: string): string {
  return `${CAR_MODELS_PATH}/${makeId}`;
}

export function carModelPath(makeId: string, modelId: string): string {
  return `${carMakePath(makeId)}/${modelId}`;
}
