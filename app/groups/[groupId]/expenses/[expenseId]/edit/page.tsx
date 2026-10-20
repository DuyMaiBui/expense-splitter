"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ExpenseForm } from "@/components/ExpenseForm";
import { Icon } from "@/components/Icon";
import { ApiClientError, api } from "@/lib/api-client";
import { canModifyExpense } from "@/lib/permissions";
import type { Expense, Group, Member, Viewer } from "@/lib/types";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/** What the page is doing: checking the caller may edit, refusing, or showing the form. */
type State =
  | { status: "checking" }
  | { status: "ready" }
  /** `refusal` is the API's own Vietnamese text when it answered 403. */
  | { status: "refused"; refusal: string };

export default function EditExpensePage() {
  const { groupId, expenseId } = useParams<{ groupId: string; expenseId: string }>();
  const [state, setState] = useState<State>({ status: "checking" });

  const listHref = `/groups/${groupId}/expenses`;

  useEffect(() => {
    let cancelled = false;

    async function check(): Promise<void> {
      try {
        // Both lookups are already in the client cache (the nav bar and the list page asked for
        // them), so this usually costs no extra Worker invocation.
        const [group, loaded] = await Promise.all([
          api<{ group: Group; members: Member[]; viewer: Viewer }>(`/api/groups/${groupId}`),
          api<{ expense: Expense }>(`/api/groups/${groupId}/expenses/${expenseId}`),
        ]);
        if (cancelled) {
          return;
        }
        // The same helper the PUT route uses, so an allowed page is an allowed save.
        if (!canModifyExpense(group.viewer, loaded.expense, group.members)) {
          setState({ status: "refused", refusal: "Bạn không có quyền sửa chi tiêu này." });
          return;
        }
        setState({ status: "ready" });
      } catch (e) {
        if (cancelled) {
          return;
        }
        // A 403 carries the server's Vietnamese message; anything else is a load failure.
        setState({
          status: "refused",
          refusal:
            e instanceof ApiClientError && e.status === 403
              ? e.message
              : message(e, "Không tải được chi tiêu."),
        });
      }
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, [groupId, expenseId]);

  return (
    <main className="container stack">
      <h1 className="row row-nowrap">
        <Icon name="pencil" size={26} />
        <span>Sửa chi tiêu</span>
      </h1>

      {state.status === "checking" && (
        <div className="spinner" role="status" aria-label="Đang tải" />
      )}

      {state.status === "refused" && (
        <div className="card stack">
          <p className="error">{state.refusal}</p>
          <Link className="btn self-start" href={listHref} prefetch={false}>
            <Icon name="arrowLeft" />
            <span>Về danh sách chi tiêu</span>
          </Link>
        </div>
      )}

      {state.status === "ready" && <ExpenseForm groupId={groupId} expenseId={expenseId} />}
    </main>
  );
}
