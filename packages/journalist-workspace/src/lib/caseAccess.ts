import type { Session } from "./session"

type CaseLike = { assigned_to: string | null }

/**
 * Returns true if the session user may access this case.
 * Journalists may only access cases assigned to them.
 * Admins and editors have full access.
 */
export function canAccessCase(session: Session, caseData: CaseLike): boolean {
  if (session.role === "journalist") {
    return caseData.assigned_to === session.userId
  }
  return true // admin and editor see all cases
}
