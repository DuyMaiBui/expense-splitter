"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { GroupsPanel } from "@/components/admin/GroupsPanel";
import { IpPanel } from "@/components/admin/IpPanel";
import { UsersPanel } from "@/components/admin/UsersPanel";
import { Icon, type IconName } from "@/components/Icon";

type TabId = "users" | "groups" | "ip";

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: "users", label: "Tài khoản", icon: "users" },
  { id: "groups", label: "Nhóm", icon: "receipt" },
  { id: "ip", label: "IP & spam", icon: "shield" },
];

/** The admin account's console: accounts, groups, and abuse controls. */
export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("users");

  // A normal account has nothing to do here.
  const onForbidden = useCallback(() => router.replace("/groups"), [router]);

  return (
    <main className="container stack">
      <h1 className="row row-nowrap">
        <Icon name="shield" size={26} />
        <span>Quản trị</span>
      </h1>

      <ul className="tabs" role="tablist">
        {TABS.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? "tab tab-icon tab-active" : "tab tab-icon"}
              style={{ background: "none", border: 0, width: "100%", cursor: "pointer" }}
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon} size={22} />
              <span>{t.label}</span>
            </button>
          </li>
        ))}
      </ul>

      {tab === "users" && <UsersPanel onForbidden={onForbidden} />}
      {tab === "groups" && <GroupsPanel onForbidden={onForbidden} />}
      {tab === "ip" && <IpPanel onForbidden={onForbidden} />}
    </main>
  );
}
