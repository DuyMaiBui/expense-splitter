"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Icon, type IconName } from "@/components/Icon";
import { api } from "@/lib/api-client";
import type { Group } from "@/lib/types";

interface GroupNavProps {
  groupId: string;
}

interface Tab {
  label: string;
  /** Shorter visible text for the narrow tab bar; `label` stays the full name. */
  short?: string;
  icon: IconName;
  href: string;
}

/** Group-scoped tab bar: icon-only tabs, each named by aria-label and tooltip. */
export function GroupNav({ groupId }: GroupNavProps) {
  const pathname = usePathname();
  const [groupName, setGroupName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Served from the client cache when a page already asked for the same group, so the nav
    // costs no request of its own. A failed lookup degrades the title, not the page.
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
    { label: "Chi tiêu", icon: "receipt", href: expensesBase },
    { label: "Thêm chi tiêu", short: "Thêm", icon: "plus", href: `${expensesBase}/new` },
    { label: "Tất toán", icon: "scale", href: `/groups/${groupId}/settle` },
    { label: "Mục mẫu", short: "Mẫu", icon: "tag", href: `/groups/${groupId}/presets` },
    { label: "Thành viên", icon: "users", href: `/groups/${groupId}/members` },
    { label: "Nhật ký", icon: "clock", href: `/groups/${groupId}/log` },
  ];

  function isActive(href: string): boolean {
    // "Thêm chi tiêu" owns only its own route.
    if (href === `${expensesBase}/new`) {
      return pathname === href;
    }
    // "Chi tiêu" owns the list and every expense detail/edit page beneath it.
    if (href === expensesBase) {
      return (
        pathname === expensesBase ||
        (pathname.startsWith(`${expensesBase}/`) && pathname !== `${expensesBase}/new`)
      );
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav className="group-nav">
      <div className="container">
        <div className="group-nav-head">
          <p className="group-nav-title truncate">{groupName ?? "…"}</p>
          {/* /groups lists every group you are in and hosts the join-by-code form. */}
          <Link
            className="btn btn-ghost"
            href="/groups"
            prefetch={false}
            aria-label="Đổi nhóm hoặc tham gia nhóm khác"
            title="Đổi nhóm hoặc tham gia nhóm khác"
          >
            <Icon name="swap" />
            <span>Đổi nhóm</span>
          </Link>
        </div>
        <ul className="tabs">
          {tabs.map((tab) => {
            const active = isActive(tab.href);
            return (
              <li key={tab.href}>
                <Link
                  className={active ? "tab tab-icon tab-active" : "tab tab-icon"}
                  href={tab.href}
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon name={tab.icon} size={22} />
                  <span>{tab.short ?? tab.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
