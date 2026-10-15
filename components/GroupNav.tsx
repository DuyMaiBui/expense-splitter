"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/lib/api-client";
import type { Group } from "@/lib/types";

interface GroupNavProps {
  groupId: string;
}

interface Tab {
  label: string;
  href: string;
}

/** Group-scoped tab bar. Renders even when the group cannot be fetched. */
export function GroupNav({ groupId }: GroupNavProps) {
  const pathname = usePathname();
  const [groupName, setGroupName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // The nav is chrome, not data: a failed lookup degrades the title instead of breaking
    // the page, and the tab links stay usable.
    api<{ group: Group }>(`/api/groups/${groupId}`)
      .then((data) => {
        if (!cancelled) {
          setGroupName(data.group.name);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGroupName(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const expensesBase = `/groups/${groupId}/expenses`;
  const tabs: Tab[] = [
    { label: "Chi tiêu", href: expensesBase },
    { label: "Thêm chi tiêu", href: `${expensesBase}/new` },
    { label: "Tất toán", href: `/groups/${groupId}/settle` },
    { label: "Thành viên", href: `/groups/${groupId}/members` },
    { label: "Nhật ký", href: `/groups/${groupId}/log` },
  ];

  function isActive(href: string): boolean {
    // "Thêm chi tiêu" owns only its own route.
    if (href === `${expensesBase}/new`) {
      return pathname === href;
    }
    // "Chi tiêu" owns the list and every expense detail/edit page beneath it.
    if (href === expensesBase) {
      return pathname === expensesBase || pathname.startsWith(`${expensesBase}/`);
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav className="group-nav">
      <div className="container">
        <p className="group-nav-title">{groupName ?? "Nhóm"}</p>
        <ul className="tabs">
          {tabs.map((tab) => {
            const active = isActive(tab.href);
            return (
              <li key={tab.href}>
                <Link
                  className={active ? "tab tab-active" : "tab"}
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
