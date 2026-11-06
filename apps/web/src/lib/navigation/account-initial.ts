/** The first letter of the User's name for the account button, or of their email without one. */
export function accountInitial(user: { fullName: string; email: string }): string {
  const source = user.fullName.trim() || user.email.trim();
  return source.charAt(0).toLocaleUpperCase("en-AU");
}
