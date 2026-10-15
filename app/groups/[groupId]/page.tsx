import { redirect } from "next/navigation";

/** A bare group URL lands on that group's expense list. */
export default async function GroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  redirect(`/groups/${groupId}/expenses`);
}
