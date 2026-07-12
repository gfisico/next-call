"use client";

/**
 * 設定 "/settings"。
 * - エンジン設定: グループ表示 + NumberField/Toggle + グループ単位「既定値に戻す」。
 *   変更は PUT /api/settings で即時保存（ネスト葉は親オブジェクトへマージ）。
 * - 楽器マスター: 一覧チップ + 追加（code 重複 409 トースト）。
 * - 母店設定: venues の isHome を Toggle で訂正。
 * - データ管理: エクスポート（ダウンロード）/ CSVインポートへの導線。Primary は置かない。
 */
import { useState } from "react";
import Link from "next/link";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { toast } from "sonner";
import { Toggle } from "@/components/session/toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";
import {
  ApiClientError,
  createInstrument,
  downloadExport,
  putSettings,
  updateVenue,
} from "@/lib/api/client";
import { useInstruments, useSettings, useVenues } from "@/lib/api/hooks";
import type { SettingsMap } from "@/lib/api/types";
import {
  SETTING_GROUPS,
  buildResetPayload,
  buildUpdatePayload,
  getSettingValue,
  type SettingGroup,
  type SettingMeta,
} from "@/lib/settings-meta";
import { cn } from "@/lib/utils";

const inputClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function SettingsScreen() {
  const { settings, isLoading, mutate: mutateSettings } = useSettings();
  const { instruments, mutate: mutateInstruments } = useInstruments();
  const { venues, mutate: mutateVenues } = useVenues();

  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SETTING_GROUPS.map((g) => [g.id, !g.collapsed])),
  );
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [addingInstrument, setAddingInstrument] = useState(false);

  async function persist(payload: SettingsMap, successMsg: string) {
    try {
      await putSettings(payload);
      await mutateSettings();
      toast.success(successMsg);
    } catch {
      toast.error("保存に失敗しました");
    }
  }

  const handleUpdate = (meta: SettingMeta, value: number | boolean) =>
    persist(
      buildUpdatePayload(settings ?? {}, meta, value),
      "保存しました（次回の推薦から有効）",
    );

  const handleReset = (group: SettingGroup) =>
    persist(buildResetPayload(settings ?? {}, group), "既定値に戻しました");

  async function handleAddInstrument() {
    const code = newCode.trim();
    const label = newLabel.trim();
    if (code === "" || label === "") {
      toast.error("コードと表示名を入力してください");
      return;
    }
    setAddingInstrument(true);
    try {
      await createInstrument({ code, label });
      await mutateInstruments();
      setNewCode("");
      setNewLabel("");
      toast.success("楽器を追加しました");
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409) {
        toast.error("同じコードの楽器が既に存在します");
      } else {
        toast.error("楽器の追加に失敗しました");
      }
    } finally {
      setAddingInstrument(false);
    }
  }

  async function handleVenueHome(id: number, isHome: boolean) {
    try {
      await updateVenue(id, { isHome });
      await mutateVenues();
      toast.success("母店設定を更新しました");
    } catch {
      toast.error("母店設定の更新に失敗しました");
    }
  }

  async function handleExport() {
    try {
      await downloadExport();
    } catch {
      toast.error("エクスポートに失敗しました");
    }
  }

  if (isLoading || !settings) {
    return <p className="text-sm text-muted-foreground">読み込み中…</p>;
  }

  const seasonMonths = settings["engine.season_months"] as
    | Record<string, number[]>
    | undefined;
  const seasonMonthLabels: Record<string, string> = {
    SPRING: "春",
    SUMMER: "夏",
    AUTUMN: "秋",
    WINTER: "冬",
  };

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold tracking-tight">設定</h1>

      {/* エンジン設定 */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">エンジン設定</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            推薦エンジンの挙動を調整します。変更は次回の推薦から反映されます。
          </p>
        </div>

        {SETTING_GROUPS.map((group) => {
          const isOpen = open[group.id];
          return (
            <div
              key={group.id}
              className="rounded-xl border border-border bg-card shadow-sm"
            >
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() =>
                  setOpen((s) => ({ ...s, [group.id]: !s[group.id] }))
                }
                className="flex w-full items-center justify-between gap-2 p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <span className="text-sm font-semibold">{group.label}</span>
                {isOpen ? (
                  <ChevronDownIcon className="size-4 text-muted-foreground" aria-hidden />
                ) : (
                  <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
                )}
              </button>
              {isOpen ? (
                <div className="border-t border-border px-4 pb-3">
                  {group.items.map((meta) =>
                    meta.type === "number" ? (
                      <NumberField
                        key={meta.id}
                        label={meta.label}
                        desc={meta.desc}
                        min={meta.min}
                        max={meta.max}
                        step={meta.step}
                        value={getSettingValue(settings, meta) as number}
                        onChange={(v) => handleUpdate(meta, v)}
                      />
                    ) : (
                      <div
                        key={meta.id}
                        className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{meta.label}</div>
                          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                            {meta.desc}
                          </p>
                        </div>
                        <Toggle
                          ariaLabel={meta.label}
                          onLabel="有効"
                          offLabel="無効"
                          value={getSettingValue(settings, meta) as boolean}
                          onChange={(v) => handleUpdate(meta, v)}
                        />
                      </div>
                    ),
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2 px-0 text-muted-foreground"
                    onClick={() => handleReset(group)}
                  >
                    既定値に戻す
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}

        {/* 季節の月マッピング（読み取り専用） */}
        {seasonMonths ? (
          <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
            <div className="mb-1 font-semibold text-foreground">
              季節の月わり（読み取り専用）
            </div>
            {Object.entries(seasonMonths).map(([k, months]) => (
              <div key={k}>
                {seasonMonthLabels[k] ?? k}: {months.join(", ")}月
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {/* 楽器マスター */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">楽器マスター</h2>
        <div className="flex flex-wrap gap-2">
          {instruments.map((i) => (
            <span
              key={i.code}
              className="inline-flex min-h-8 items-center rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground"
              title={i.label}
            >
              {i.code}
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            className={cn(inputClass, "flex-1")}
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="コード（例: vib）"
            aria-label="楽器コード"
          />
          <Input
            className={cn(inputClass, "flex-[1.4]")}
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="表示名（例: ヴィブラフォン）"
            aria-label="楽器の表示名"
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          className="h-10 w-full"
          disabled={addingInstrument}
          onClick={handleAddInstrument}
        >
          楽器を追加
        </Button>
      </section>

      {/* 母店設定 */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">母店設定</h2>
        <p className="text-xs text-muted-foreground">
          店舗の母店区分を修正できます（開始時の判定の訂正手段）。
        </p>
        <ul className="space-y-2">
          {venues.map((v) => (
            <li
              key={v.id}
              className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 shadow-sm"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {v.name}
              </span>
              <Toggle
                ariaLabel={`${v.name} の母店区分`}
                onLabel="母店"
                offLabel="母店以外"
                value={v.isHome}
                onChange={(isHome) => handleVenueHome(v.id, isHome)}
              />
            </li>
          ))}
        </ul>
      </section>

      {/* データ管理 */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">データ管理</h2>
        <Button
          type="button"
          variant="secondary"
          className="h-10 w-full"
          onClick={handleExport}
        >
          全データをエクスポート（ダウンロード）
        </Button>
        <Button asChild variant="secondary" className="h-10 w-full">
          <Link href="/settings/import">CSVインポート →</Link>
        </Button>
      </section>
    </div>
  );
}
