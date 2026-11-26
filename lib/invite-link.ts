/**
 * Invite links: `/groups?invite=<CODE>` opens the groups page with the join form pre-filled.
 * A signed-out visitor is sent through /login (or /register) with `?next=<that path>`, and
 * `safeNext` decides whether that `next` may be followed after signing in.
 */

export const INVITE_PARAM = "invite";
export const NEXT_PARAM = "next";

/** Absolute invite URL for `code` on `origin` (e.g. window.location.origin). */
export function inviteUrl(origin: string, code: string): string {
  return `${origin}/groups?${INVITE_PARAM}=${encodeURIComponent(code)}`;
}

/**
 * `next` when it is a same-origin path ("/groups?invite=AB12"), else null. Rejects
 * protocol-relative ("//evil.com"), backslash ("/\\evil.com") and absolute URLs, so a crafted
 * link cannot bounce a fresh login to another site.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return null;
  }
  return next;
}
