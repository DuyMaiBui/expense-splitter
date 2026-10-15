"use client";

import { useParams } from "next/navigation";

import { ExpenseForm } from "@/components/ExpenseForm";

export default function NewExpensePage() {
  const { groupId } = useParams<{ groupId: string }>();

  return (
    <main className="container stack">
      <h1>Thêm chi tiêu</h1>
      <ExpenseForm groupId={groupId} />
    </main>
  );
}
