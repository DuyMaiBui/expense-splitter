"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Icon } from "@/components/Icon";
import {
  bankLogoUrl,
  banksByShortName,
  popularBanks,
  searchBanks,
  type BankEntry,
} from "@/lib/vietqr";

/** Which bank a row's logo draws, and how big its square chip is. */
interface BankLogoProps {
  entry: BankEntry | null;
  /** Rendered square, in px. The image never exceeds its chip. */
  size?: number;
}

/**
 * A bank's logo on a white rounded chip: the logos are dark artwork on a transparent or white
 * field, so they need a light backing to stay legible on the dark surface. Decorative — the bank
 * name is always beside it — so it is `alt=""` and `aria-hidden`, and a bank with no logo (or a
 * failed request) shows the bank icon instead of an empty box.
 */
export function BankLogo({ entry, size = 32 }: BankLogoProps) {
  // The failure is remembered per URL, not per component: the same chip shows a different bank
  // when the trigger's choice changes, and one broken logo must not poison the next one.
  const url = entry ? bankLogoUrl(entry) : null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = url !== null && failedUrl !== url;
  const glyph = Math.round(size * 0.62);

  return (
    <span className="bank-logo" style={{ width: size, height: size }} aria-hidden="true">
      {showImage ? (
        <img
          className="bank-logo-img"
          src={url}
          alt=""
          width={size - 6}
          height={size - 6}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <Icon name="bank" size={glyph} />
      )}
    </span>
  );
}

interface BankPickerProps {
  /** The selected BIN, "" for none. */
  value: string;
  onChange: (bin: string) => void;
  /** The form's visible label, rendered by the picker so the control is properly named. */
  label: string;
  /** Marks the choice required for assistive tech; the form still validates it on submit. */
  required?: boolean;
  disabled?: boolean;
}

/** One rendered section, with the flat index range its rows occupy in the keyboard order. */
interface PickerSection {
  key: string;
  label: string;
  banks: BankEntry[];
  start: number;
}

/**
 * A searchable bank combobox: the trigger shows the chosen bank, and the panel opens IN FLOW
 * under it (no portal, no fixed overlay), so it works at 375px and inside the form's own
 * scrolling rather than being clipped by it. Popular banks come first, then every bank A-Z; a
 * query replaces both sections with one flat result list.
 */
export function BankPicker({ value, onChange, label, required = false, disabled = false }: BankPickerProps) {
  const fieldId = useId();
  const listId = `${fieldId}-list`;
  const labelId = `${fieldId}-label`;
  const valueId = `${fieldId}-value`;
  const optionId = (index: number) => `${fieldId}-option-${index}`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => banksByShortName(), []);
  const popular = useMemo(() => popularBanks(), []);
  const trimmed = query.trim();
  const results = useMemo(() => (trimmed ? searchBanks(trimmed) : all), [trimmed, all]);

  const selected = all.find((bank) => bank.bin === value) ?? null;
  // A BIN stored before this picker existed is not in the list; it stays selectable (and stays
  // visible) instead of snapping to "" and silently rewriting the account on the next save.
  const current: BankEntry | null =
    value !== "" && selected === null
      ? { bin: value, code: "", shortName: `Ngân hàng hiện tại (BIN ${value})`, name: "" }
      : null;

  const groups: { key: string; label: string; banks: BankEntry[] }[] = trimmed
    ? [{ key: "results", label: "Kết quả", banks: results }]
    : [
        ...(current ? [{ key: "current", label: "Hiện tại", banks: [current] }] : []),
        { key: "popular", label: "Phổ biến", banks: popular },
        { key: "all", label: "Tất cả", banks: all },
      ];

  // The flat order is exactly what ArrowUp/ArrowDown walks and what the option ids index: the
  // same sections, read in DOM order, numbered from the top.
  const sections: PickerSection[] = groups.reduce<PickerSection[]>((acc, group) => {
    const start = acc.length === 0 ? 0 : acc[acc.length - 1].start + acc[acc.length - 1].banks.length;
    return [...acc, { ...group, start }];
  }, []);
  const options = sections.flatMap((section) => section.banks);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  // A new query narrows the list, so the cursor starts at its first row.
  useEffect(() => {
    setActive(0);
  }, [trimmed]);

  // The highlighted row stays visible inside the scrolling list, never under the fold.
  useEffect(() => {
    if (!open) {
      return;
    }
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  // A tap anywhere outside the field closes the panel; focus may be on the input, a row or the
  // trigger, so this cannot rely on blur alone.
  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function close(returnFocus: boolean): void {
    setOpen(false);
    setQuery("");
    if (returnFocus) {
      triggerRef.current?.focus();
    }
  }

  function choose(bank: BankEntry): void {
    onChange(bank.bin);
    close(true);
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(options.length - 1, 0));
    } else if (event.key === "Enter") {
      // Choosing must not submit the surrounding form.
      event.preventDefault();
      const bank = options[active];
      if (bank) {
        choose(bank);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  }

  // Typing while the trigger has focus opens the panel with that first character as the query.
  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      setQuery(event.key);
      setOpen(true);
    } else if (event.key === "Escape") {
      close(false);
    }
  }

  const triggerLabel = selected?.shortName ?? current?.shortName ?? "Chọn ngân hàng…";

  return (
    <div className="bank-field" ref={rootRef}>
      <span className="label" id={labelId}>
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className="input bank-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => {
          if (open) {
            close(false);
          } else {
            setQuery("");
            setOpen(true);
          }
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <BankLogo entry={selected ?? current} size={28} />
        <span className="truncate bank-trigger-label" id={valueId}>
          {triggerLabel}
        </span>
        <Icon name="chevronDown" size={18} />
      </button>

      {open && (
        <div className="bank-panel">
          <input
            ref={inputRef}
            type="search"
            className="input bank-search"
            aria-label="Tìm ngân hàng"
            placeholder="Tìm theo tên, mã hoặc BIN"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={options.length > 0 ? optionId(active) : undefined}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
          />

          {options.length === 0 ? (
            <p className="bank-empty" role="status">
              Không tìm thấy ngân hàng
            </p>
          ) : (
            <div className="bank-list" id={listId} role="listbox" aria-label="Ngân hàng" ref={listRef}>
              {sections.map((section) => (
                <div className="bank-section" key={section.key} role="group" aria-label={section.label}>
                  <span className="bank-section-title">{section.label}</span>
                  {section.banks.map((bank, offset) => {
                    const index = section.start + offset;
                    const isActive = index === active;
                    return (
                      <button
                        key={`${section.key}-${bank.bin}`}
                        type="button"
                        role="option"
                        id={optionId(index)}
                        data-index={index}
                        tabIndex={-1}
                        aria-selected={bank.bin === value}
                        className={`bank-option${isActive ? " bank-option-active" : ""}`}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => choose(bank)}
                      >
                        <BankLogo entry={bank} />
                        <span className="bank-option-text">
                          <span className="bank-option-name truncate">{bank.shortName}</span>
                          {bank.name !== "" && (
                            <span className="bank-option-full truncate">{bank.name}</span>
                          )}
                        </span>
                        {bank.bin === value && <Icon name="check" size={18} />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
