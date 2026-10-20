"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

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
  const scrollerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLAnchorElement>());
  // Which edges have content hidden past them: each one gets a fade so the bar reads as scrollable.
  const [edges, setEdges] = useState({ left: false, right: false });

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

  const activeHref =
    tabs.find((tab) => isActive(tab.href))?.href ?? tabs[0]!.href;

  const measureEdges = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    const max = scroller.scrollWidth - scroller.clientWidth;
    const next = {
      left: scroller.scrollLeft > 1,
      right: max - scroller.scrollLeft > 1,
    };
    // Same object when nothing moved: a scroll event must not cost a render per pixel.
    setEdges((current) =>
      current.left === next.left && current.right === next.right ? current : next,
    );
  }, []);

  // The last tab is easy to miss when the row overflows, so the active one is centred on mount
  // and on every route change. Done with scrollLeft rather than scrollIntoView: the latter also
  // scrolls the page vertically on some browsers, moving the whole document under the tap.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const tab = tabRefs.current.get(activeHref);
    if (!scroller || !tab) {
      return;
    }
    const target = tab.offsetLeft - (scroller.clientWidth - tab.offsetWidth) / 2;
    const max = scroller.scrollWidth - scroller.clientWidth;
    scroller.scrollTo({ left: Math.max(0, Math.min(target, max)), behavior: "instant" });
    measureEdges();
  }, [activeHref, measureEdges]);

  useEffect(() => {
    measureEdges();
    window.addEventListener("resize", measureEdges);
    return () => window.removeEventListener("resize", measureEdges);
  }, [measureEdges]);

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
        <div
          ref={scrollerRef}
          className={`tab-scroller${edges.left ? " fade-left" : ""}${edges.right ? " fade-right" : ""}`}
          onScroll={measureEdges}
        >
          <ul className="tabs">
            {tabs.map((tab) => {
              const active = tab.href === activeHref;
              return (
                <li key={tab.href}>
                  <Link
                    ref={(node) => {
                      if (node) {
                        tabRefs.current.set(tab.href, node);
                      } else {
                        tabRefs.current.delete(tab.href);
                      }
                    }}
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
      </div>
    </nav>
  );
}
