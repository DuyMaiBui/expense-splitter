"use client";

import { useParams } from "next/navigation";

import { ExpenseForm } from "@/components/ExpenseForm";

export default function EditExpensePage() {
  const { groupId, expenseId } = useParams<{ groupId: string; expenseId: string }>();

  return (
    <main className="container stack">
      <h1>Sửa chi tiêu</h1>
      <ExpenseForm groupId={groupId} expenseId={expenseId} />
    </main>
  );
}
