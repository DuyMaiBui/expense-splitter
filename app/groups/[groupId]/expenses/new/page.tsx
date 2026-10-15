"use client";

import { useParams } from "next/navigation";

import { ExpenseForm } from "@/components/ExpenseForm";
import { Icon } from "@/components/Icon";

export default function NewExpensePage() {
  const { groupId } = useParams<{ groupId: string }>();

  return (
    <main className="container stack">
      <h1 className="row row-nowrap">
        <Icon name="plus" size={26} />
        <span>Thêm chi tiêu</span>
      </h1>
      <ExpenseForm groupId={groupId} />
    </main>
  );
}
