"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { Icon, IconButton } from "@/components/Icon";
import { api } from "@/lib/api-client";
import { formatVnd, parseAmountInput } from "@/lib/format";
import { MAX_PRESET_PRICE } from "@/lib/presets";
import type { Group, Preset } from "@/lib/types";

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

interface SyncResult {
  added: number;
  updated: number;
  skipped: number;
  presets: Preset[];
}

export default function PresetsPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [otherGroups, setOtherGroups] = useState<Group[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [priceText, setPriceText] = useState("");
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");

  const [sourceId, setSourceId] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(
    async (fresh = false) => {
      try {
        const [list, groups] = await Promise.all([
          api<{ presets: Preset[] }>(`/api/groups/${groupId}/presets`, { fresh }),
          api<{ groups: Group[] }>("/api/groups", { fresh }),
        ]);
        setPresets(list.presets);
        setOtherGroups(groups.groups.filter((g) => g.id !== groupId));
        setError(null);
      } catch (e) {
        setError(message(e, "Không tải được mục mẫu."));
      }
    },
    [groupId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  function priceOrThrow(text: string): number {
    const value = parseAmountInput(text);
    if (!Number.isFinite(value) || value < 1 || value > MAX_PRESET_PRICE) {
      throw new Error("Giá phải là số nguyên dương, tối đa 1.000.000.000đ.");
    }
    return value;
  }

  async function handleAdd(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setAdding(true);
    try {
      await api(`/api/groups/${groupId}/presets`, {
        method: "POST",
        body: { name, unitPrice: priceOrThrow(priceText) },
      });
      setName("");
      setPriceText("");
      await load();
    } catch (e) {
      setError(message(e, "Không thêm được mục mẫu."));
    } finally {
      setAdding(false);
    }
  }

  function startEdit(preset: Preset): void {
    setEditingId(preset.id);
    setEditName(preset.name);
    setEditPrice(String(preset.unitPrice));
    setError(null);
  }

  async function handleSave(preset: Preset): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await api(`/api/groups/${groupId}/presets/${preset.id}`, {
        method: "PUT",
        body: { name: editName, unitPrice: priceOrThrow(editPrice) },
      });
      setEditingId(null);
      await load();
    } catch (e) {
      setError(message(e, "Không lưu được mục mẫu."));
    }
  }

  async function handleDelete(preset: Preset): Promise<void> {
    if (!window.confirm(`Xóa mục mẫu "${preset.name}"? Các chi tiêu đã tạo không bị ảnh hưởng.`)) {
      return;
    }
    setError(null);
    setNotice(null);
    try {
      await api(`/api/groups/${groupId}/presets/${preset.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(message(e, "Không xóa được mục mẫu."));
    }
  }

  async function handleSync(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSyncing(true);
    try {
      const result = await api<SyncResult>(`/api/groups/${groupId}/presets/sync`, {
        method: "POST",
        body: { sourceGroupId: sourceId, overwrite },
      });
      setPresets(result.presets);
      setNotice(
        `Đã thêm ${result.added}, cập nhật giá ${result.updated}, bỏ qua ${result.skipped} mục trùng tên.`,
      );
    } catch (e) {
      setError(message(e, "Không đồng bộ được mục mẫu."));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <main className="container stack">
      <div className="row row-between row-nowrap">
        <h1 className="row row-nowrap">
          <Icon name="tag" size={26} />
          <span>Mục mẫu</span>
        </h1>
        <IconButton icon="refresh" label="Làm mới" variant="ghost" onClick={() => void load(true)} />
      </div>
      <p className="muted">
        Đặt sẵn giá một đơn vị (ví dụ quả cầu lông 29.000đ). Khi thêm chi tiêu, chọn mục mẫu và nhập số
        lượng, hệ thống tự tính tiền. Vẫn có thể nhập thẳng số tiền như bình thường.
      </p>

      {error && <p className="error">{error}</p>}
      {notice && <p className="success">{notice}</p>}
      {!presets && !error && <div className="spinner" role="status" aria-label="Đang tải" />}
      {presets && presets.length === 0 && <p className="empty">Nhóm chưa có mục mẫu nào.</p>}

      {presets && presets.length > 0 && (
        <div className="card stack">
          {presets.map((preset) =>
            editingId === preset.id ? (
              <div key={preset.id} className="stack">
                {/* Two fields on one row pushed both labels into wrapping; stacked they read as
                    "name, then price", and the two 40px controls sit beside the second one. */}
                <div className="field">
                  <Icon name="tag" />
                  <input
                    className="input"
                    maxLength={50}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    aria-label="Tên mục mẫu"
                    placeholder="Tên mục mẫu"
                  />
                </div>
                <div className="row row-nowrap">
                  <div className="field">
                    <Icon name="coins" />
                    <input
                      className="input"
                      inputMode="numeric"
                      value={editPrice}
                      onChange={(e) => setEditPrice(e.target.value)}
                      aria-label="Giá một đơn vị"
                      placeholder="Giá / đơn vị"
                    />
                  </div>
                  <IconButton
                    icon="check"
                    label="Lưu"
                    variant="primary"
                    onClick={() => void handleSave(preset)}
                  />
                  <IconButton icon="x" label="Hủy" onClick={() => setEditingId(null)} />
                </div>
              </div>
            ) : (
              <div key={preset.id} className="row row-between row-nowrap">
                <span className="row row-nowrap grow">
                  <Icon name="tag" />
                  <strong className="truncate">{preset.name}</strong>
                </span>
                <span className="preset-price">
                  <strong className="amount">{formatVnd(preset.unitPrice)}</strong>
                  <span className="meta">/ đơn vị</span>
                </span>
                <span className="row row-nowrap card-actions">
                  <IconButton
                    icon="pencil"
                    label="Sửa"
                    title={`Sửa ${preset.name}`}
                    variant="ghost"
                    onClick={() => startEdit(preset)}
                  />
                  <IconButton
                    icon="trash"
                    label="Xóa"
                    title={`Xóa ${preset.name}`}
                    variant="danger"
                    onClick={() => void handleDelete(preset)}
                  />
                </span>
              </div>
            ),
          )}
        </div>
      )}

      <form className="card stack" onSubmit={handleAdd}>
        <strong className="row row-nowrap">
          <Icon name="plus" />
          <span>Thêm mục mẫu</span>
        </strong>
        <div className="row">
          <div className="field">
            <Icon name="tag" />
            <input
              className="input"
              maxLength={50}
              placeholder="Tên mục mẫu"
              aria-label="Tên mục mẫu"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <Icon name="coins" />
            <input
              className="input"
              inputMode="numeric"
              placeholder="Giá / đơn vị"
              aria-label="Giá một đơn vị"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="row row-between">
          <span />
          <button className="btn btn-primary" type="submit" disabled={adding}>
            <Icon name="plus" />
            <span>Thêm</span>
          </button>
        </div>
      </form>

      <form className="card stack" onSubmit={handleSync}>
        <strong className="row row-nowrap">
          <Icon name="swap" />
          <span>Đồng bộ từ nhóm khác</span>
        </strong>
        {otherGroups.length === 0 ? (
          <p className="muted">Bạn chưa tham gia nhóm nào khác để đồng bộ.</p>
        ) : (
          <>
            <label className="label" htmlFor="sync-source">
              Lấy mục mẫu từ nhóm
            </label>
            <select
              id="sync-source"
              className="input"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              required
            >
              <option value="">Chọn nhóm…</option>
              {otherGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <label className="row row-nowrap" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              <span>Cập nhật giá của các mục trùng tên (mặc định giữ nguyên giá hiện tại)</span>
            </label>
            <div className="row row-between">
              <span className="muted">Mục chưa có sẽ được thêm, mục đã có không bị xóa.</span>
              <button className="btn" type="submit" disabled={syncing || sourceId === ""}>
                <Icon name="swap" />
                <span>Đồng bộ</span>
              </button>
            </div>
          </>
        )}
      </form>
    </main>
  );
}
