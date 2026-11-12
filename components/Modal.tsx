"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

import { IconButton } from "@/components/Icon";

import styles from "./Modal.module.css";

export interface ModalProps {
  /** Whether the dialog is shown. Closed renders nothing and holds no page side effects. */
  open: boolean;
  /** Heading of the dialog, announced as its accessible name. */
  title: string;
  /** Optional line under the title, used as the accessible description. */
  subtitle?: string;
  /** Called for the close button, Esc and a click on the backdrop. The caller clears `open`. */
  onClose: () => void;
  children: ReactNode;
}

/** Elements Tab may land on inside the dialog. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog over the page: a dimmed backdrop, a header pinned at the top, and a body that
 * alone scrolls. It owns the dialog behaviour so every caller gets the same accessibility:
 * focus moves in on open and back to the opener on close, Tab stays inside, Esc and a backdrop
 * click close it, and the page behind does not scroll while it is open.
 *
 * Closed renders nothing. Open mounts `ModalPanel`, so the page effects (scroll lock, focus,
 * Esc listener) exist only while the dialog is shown and are undone when it closes.
 */
export function Modal({ open, title, subtitle, onClose, children }: ModalProps) {
  if (!open) {
    return null;
  }
  return (
    <ModalPanel title={title} subtitle={subtitle} onClose={onClose}>
      {children}
    </ModalPanel>
  );
}

function ModalPanel({
  title,
  subtitle,
  onClose,
  children,
}: Omit<ModalProps, "open" | "children"> & { children: ReactNode }) {
  const titleId = useId();
  const subtitleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // The effects below are mount-only. The caller usually passes an inline onClose, which changes
  // every render; reading it through a ref keeps the focus effect from re-running (and sending
  // focus back to the opener) on each parent render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Scroll lock, and focus in and out. The opener is whatever held focus before the dialog
  // mounted; it gets focus back on unmount, unless it has left the page in the meantime.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      body.style.overflow = previousOverflow;
      if (previous?.isConnected) {
        previous.focus();
      }
    };
  }, []);

  // Esc closes; Tab and Shift+Tab wrap inside the panel so focus cannot reach the page behind.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const panel = panelRef.current;
      if (!panel) {
        return;
      }
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
        return;
      }
      if (event.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        // Only a press that starts on the dimmed area closes it; a drag out of the sheet does not.
        if (event.target === event.currentTarget) {
          onCloseRef.current();
        }
      }}
    >
      <div
        ref={panelRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
      >
        <header className={styles.head}>
          <div className={styles.titles}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {subtitle && (
              <p id={subtitleId} className={styles.subtitle}>
                {subtitle}
              </p>
            )}
          </div>
          <IconButton icon="x" label="Đóng" variant="ghost" onClick={onClose} />
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
