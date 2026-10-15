import type { ReactNode } from "react";

import { GroupNav } from "@/components/GroupNav";

/** Shared chrome for every page under /groups/[groupId]. */
export default async function GroupLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;

  return (
    <>
      <GroupNav groupId={groupId} />
      {children}
    </>
  );
}
