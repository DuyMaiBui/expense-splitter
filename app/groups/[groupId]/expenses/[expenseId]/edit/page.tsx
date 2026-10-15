"use client";

import { useParams } from "next/navigation";

import { ExpenseForm } from "@/components/ExpenseForm";
import { Icon } from "@/components/Icon";

export default function EditExpensePage() {
  const { groupId, expenseId } = useParams<{ groupId: string; expenseId: string }>();

  return (
    <main className="container stack">
      <h1 className="row row-nowrap">
        <Icon name="pencil" size={26} />
        <span>Sửa chi tiêu</span>
      </h1>
      <ExpenseForm groupId={groupId} expenseId={expenseId} />
    </main>
  );
}
