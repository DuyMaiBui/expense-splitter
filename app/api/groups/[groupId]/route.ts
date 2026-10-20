import { requireGroupMember, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { internal } from "@/lib/errors";
import { buildViewer, getGroupAdminView, getGroupView, listMembers } from "@/lib/group-queries";
import { ok, route } from "@/lib/http";

export const GET = route(async (_req, ctx) => {
  const { groupId } = await ctx.params;
  const user = await requireUser();
  const actor = await requireGroupMember(groupId, user);

  const db = getDb();
  const [group, members] = await Promise.all([
    user.role === "admin" ? getGroupAdminView(db, groupId) : getGroupView(db, groupId, user.id),
    listMembers(db, groupId),
  ]);
  if (!group) {
    throw internal();
  }
  // The caller's own permissions, so a page never has to re-derive a rule the routes enforce.
  return ok({ group, members, viewer: buildViewer(user, actor) });
});
