import { USER_SESSION, signInNotice } from "@fleetapp/auth/login-policy";

import { SignInScreen } from "./sign-in-screen";

export default async function SignInPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <SignInScreen notice={signInNotice(await props.searchParams, USER_SESSION)} />;
}
