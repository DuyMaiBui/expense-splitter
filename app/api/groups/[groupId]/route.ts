import { requireGroupMember, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { internal } from "@/lib/errors";
import { getGroupAdminView, getGroupView, listMembers } from "@/lib/group-queries";
import { ok, route } from "@/lib/http";

export const GET = route(async (_req, ctx) => {
  const { groupId } = await ctx.params;
  const user = await requireUser();
  await requireGroupMember(groupId, user);

  const db = getDb();
  const [group, members] = await Promise.all([
    user.role === "admin" ? getGroupAdminView(db, groupId) : getGroupView(db, groupId, user.id),
    listMembers(db, groupId),
  ]);
  if (!group) {
    throw internal();
  }
  return ok({ group, members });
});
