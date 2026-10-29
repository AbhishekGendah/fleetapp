/**
 * Who is making a change: the signed-in User and their Operator, both from
 * the session, never from the form (rule 1). Every write logs it (rule 19).
 */
export interface ActingUser {
  userId: string;
  operatorId: string;
}
