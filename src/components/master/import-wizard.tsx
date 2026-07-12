"use client";

/**
 * CSVインポートウィザード "/settings/import"（4段階 state machine）。
 *
 * Step1 アップロード → Step2 プレビュー（エラー行・店舗区分・曲名解決）
 *  → Step3 ドライラン差分 → Step4 コミット/結果。
 *
 * 中断再開: 単一ジョブの再取得 GET が unit-08 に無いため、プレビュー結果・解決選択・
 * ステップを sessionStorage に保存し、同一ブラウザでの再開を実現する（別端末は範囲外）。
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/session/confirm-dialog";
import { Segment } from "@/components/session/segment";
import { Toggle } from "@/components/session/toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { WizardSteps } from "@/components/master/wizard-steps";
import {
  ApiClientError,
  commitImport,
  discardImport,
  fetchDryRun,
  saveResolutions,
  uploadImport,
} from "@/lib/api/client";
import type {
  CommitSummary,
  DryRunSummary,
  ImportType,
  PreviewResult,
  ResolutionsPayload,
  SetlistUnknowns,
  TitleResolution,
} from "@/lib/api/types";

const STEP_LABELS = ["アップロード", "プレビュー", "ドライラン", "コミット"];

const STORAGE_KEY = "next-call:import:jobs";

/** sessionStorage に保存する再開用スナップショット */
interface SavedJob {
  jobId: number;
  type: ImportType;
  fileName: string;
  startedAt: string;
  step: number;
  preview: PreviewResult;
  resolutions: ResolutionsPayload;
}

interface WizardState {
  step: 1 | 2 | 3 | 4;
  type: ImportType;
  jobId: number | null;
  fileName: string | null;
  startedAt: string;
  preview: PreviewResult | null;
  resolutions: ResolutionsPayload;
  dryRun: DryRunSummary | null;
  commit: CommitSummary | null;
}

const emptyResolutions = (): ResolutionsPayload => ({ venues: {}, titles: {} });

const initialState = (): WizardState => ({
  step: 1,
  type: "songs",
  jobId: null,
  fileName: null,
  startedAt: "",
  preview: null,
  resolutions: emptyResolutions(),
  dryRun: null,
  commit: null,
});

// --- sessionStorage ヘルパ（SSR/例外セーフ） -------------------------------

function readJobs(): SavedJob[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedJob[]) : [];
  } catch {
    return [];
  }
}

function writeJobs(jobs: SavedJob[]): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    /* quota 等は無視 */
  }
}

function upsertJob(job: SavedJob): void {
  const jobs = readJobs().filter((j) => j.jobId !== job.jobId);
  writeJobs([job, ...jobs]);
}

function removeJob(jobId: number): void {
  writeJobs(readJobs().filter((j) => j.jobId !== jobId));
}

// --- 表示メタ ---------------------------------------------------------------

const DRY_RUN_ROWS: ReadonlyArray<{ key: keyof DryRunSummary; label: string }> =
  [
    { key: "songsToCreate", label: "新規曲" },
    { key: "songsToUpdate", label: "既存曲の更新" },
    { key: "venuesToCreate", label: "新規店舗" },
    { key: "sessionsToCreate", label: "新規セッション" },
    { key: "performancesToCreate", label: "演奏記録" },
    { key: "stubsToCreate", label: "スタブ作成" },
    { key: "skippedRows", label: "スキップ" },
  ];

const isSetlistUnknowns = (u: unknown): u is SetlistUnknowns =>
  !!u && typeof u === "object" && "venues" in u && "titles" in u;

export function ImportWizard() {
  const [state, setState] = useState<WizardState>(initialState);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [recalc, setRecalc] = useState(true);
  const [resumable, setResumable] = useState<SavedJob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // マウント時に中断中ジョブを読み込む
  useEffect(() => {
    setResumable(readJobs());
  }, []);

  const patch = (p: Partial<WizardState>) => setState((s) => ({ ...s, ...p }));

  // --- Step1: アップロード ---
  async function handleUpload() {
    if (!file) {
      toast.error("CSVファイルを選択してください");
      return;
    }
    setUploading(true);
    try {
      const preview = await uploadImport(state.type, file);
      const startedAt = new Date().toISOString();
      const resolutions = seedResolutions(preview);
      const next: WizardState = {
        ...state,
        step: 2,
        jobId: preview.job.id,
        fileName: file.name,
        startedAt,
        preview,
        resolutions,
        dryRun: null,
        commit: null,
      };
      setState(next);
      upsertJob({
        jobId: preview.job.id,
        type: state.type,
        fileName: file.name,
        startedAt,
        step: 2,
        preview,
        resolutions,
      });
      setResumable(readJobs());
    } catch {
      toast.error("アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  }

  /** プレビュー応答から曲名解決の初期値を作る（候補ありは先頭候補に一致・候補なしは未解決） */
  function seedResolutions(preview: PreviewResult): ResolutionsPayload {
    const titles: Record<string, TitleResolution> = {};
    if (isSetlistUnknowns(preview.unknowns)) {
      for (const t of preview.unknowns.titles) {
        if (t.candidates.length > 0) {
          titles[t.csvTitle] = {
            action: "match",
            songId: t.candidates[0].songId,
          };
        }
      }
    }
    return { venues: {}, titles };
  }

  function resume(job: SavedJob) {
    setState({
      step: (job.step as 1 | 2 | 3 | 4) ?? 2,
      type: job.type,
      jobId: job.jobId,
      fileName: job.fileName,
      startedAt: job.startedAt,
      preview: job.preview,
      resolutions: job.resolutions,
      dryRun: null,
      commit: null,
    });
  }

  function persistCurrent(next: WizardState) {
    if (next.jobId == null || next.preview == null) return;
    upsertJob({
      jobId: next.jobId,
      type: next.type,
      fileName: next.fileName ?? "",
      startedAt: next.startedAt,
      step: next.step,
      preview: next.preview,
      resolutions: next.resolutions,
    });
    setResumable(readJobs());
  }

  // --- Step2: 解決の更新 ---
  function setVenueHome(name: string, isHome: boolean) {
    setState((s) => ({
      ...s,
      resolutions: {
        ...s.resolutions,
        venues: { ...s.resolutions.venues, [name]: isHome },
      },
    }));
  }

  function setTitleAction(
    csvTitle: string,
    action: TitleResolution["action"],
    songId?: number,
  ) {
    setState((s) => ({
      ...s,
      resolutions: {
        ...s.resolutions,
        titles: {
          ...s.resolutions.titles,
          [csvTitle]: { action, ...(songId !== undefined ? { songId } : {}) },
        },
      },
    }));
  }

  function bulkStubUnresolved() {
    setState((s) => {
      if (!isSetlistUnknowns(s.preview?.unknowns)) return s;
      const titles = { ...s.resolutions.titles };
      for (const t of s.preview.unknowns.titles) {
        if (!titles[t.csvTitle]) titles[t.csvTitle] = { action: "create_stub" };
      }
      return { ...s, resolutions: { ...s.resolutions, titles } };
    });
  }

  // --- Step2 → Step3: 解決保存 + ドライラン ---
  async function handleDryRun() {
    if (state.jobId == null) return;
    setBusy(true);
    try {
      if (state.type === "setlists") {
        await saveResolutions(state.jobId, state.resolutions);
      }
      const summary = await fetchDryRun(state.jobId);
      const next: WizardState = { ...state, step: 3, dryRun: summary };
      setState(next);
      persistCurrent(next);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409) {
        toast.error("このジョブは既に確定/破棄されています");
      } else {
        toast.error("ドライランに失敗しました");
      }
    } finally {
      setBusy(false);
    }
  }

  // --- Step4: コミット ---
  async function handleCommit() {
    if (state.jobId == null) return;
    setBusy(true);
    try {
      const summary = await commitImport(state.jobId, {
        recalcHasPlayed: recalc,
      });
      removeJob(state.jobId);
      setResumable(readJobs());
      setState((s) => ({ ...s, commit: summary }));
      toast.success("取込が完了しました");
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409) {
        toast.error("このジョブは既に確定/破棄されています");
      } else {
        toast.error("コミットに失敗しました");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDiscard() {
    setDiscardOpen(false);
    if (state.jobId == null) return;
    setBusy(true);
    try {
      await discardImport(state.jobId);
      removeJob(state.jobId);
      setResumable(readJobs());
      toast.success("インポートを破棄しました");
      restart();
    } catch {
      toast.error("破棄に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setState(initialState());
    setFile(null);
    setRecalc(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setResumable(readJobs());
  }

  const preview = state.preview;
  const setlistUnknowns =
    preview && isSetlistUnknowns(preview.unknowns) ? preview.unknowns : null;
  const unresolvedTitles =
    setlistUnknowns?.titles.filter((t) => !state.resolutions.titles[t.csvTitle])
      .length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/settings" aria-label="設定へ戻る">
            ‹ 設定
          </Link>
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">CSVインポート</h1>
      </div>

      <WizardSteps steps={STEP_LABELS} current={state.step - 1} />

      {/* ============ Step 1: アップロード ============ */}
      {state.step === 1 ? (
        <div className="space-y-4">
          <div className="grid gap-2">
            <span className="text-sm font-medium">インポートの種類</span>
            <Segment
              ariaLabel="インポートの種類"
              value={state.type}
              onChange={(v) => patch({ type: v })}
              options={[
                { value: "songs", label: "曲マスター" },
                { value: "setlists", label: "セットリスト履歴" },
              ]}
            />
          </div>
          <div className="grid gap-2">
            <label htmlFor="import-file" className="text-sm font-medium">
              CSVファイル
            </label>
            <input
              id="import-file"
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              aria-label="CSVファイル"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1 file:text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <Button
            type="button"
            className="h-10 w-full"
            disabled={uploading || !file}
            onClick={handleUpload}
          >
            アップロードしてプレビューへ
          </Button>

          {resumable.length > 0 ? (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold">中断中のインポート</h2>
              <ul className="space-y-2">
                {resumable.map((job) => (
                  <li
                    key={job.jobId}
                    className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 shadow-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {job.fileName || "(no name)"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {job.startedAt.slice(0, 10)} ・ プレビュー中（job #
                        {job.jobId}）
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => resume(job)}
                    >
                      再開
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ============ Step 2: プレビュー ============ */}
      {state.step === 2 && preview ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
            {state.fileName ? (
              <span className="font-medium">{state.fileName} — </span>
            ) : null}
            総行数 <strong>{preview.totalRows}</strong> / 有効{" "}
            <strong>{preview.validRows}</strong> / エラー{" "}
            <strong>{preview.errors.length}</strong>{" "}
            {preview.errors.length > 0 ? (
              <Badge variant="destructive">
                エラー {preview.errors.length}件
              </Badge>
            ) : (
              <Badge variant="success">エラーなし</Badge>
            )}
          </div>

          {preview.errors.length > 0 ? (
            <div className="grid gap-2">
              <span className="text-sm font-medium">
                エラー行（インポート対象外）
              </span>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">行</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">理由</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground">元データ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.errors.map((row) => (
                      <tr key={row.line} className="border-t border-border">
                        <td className="px-3 py-2 align-top">{row.line}</td>
                        <td className="px-3 py-2 align-top">{row.reason}</td>
                        <td className="px-3 py-2 align-top text-muted-foreground">
                          {Object.values(row.raw).join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* setlists のみ: 店舗区分・曲名解決 */}
          {setlistUnknowns ? (
            <>
              {setlistUnknowns.venues.length > 0 ? (
                <div className="grid gap-2">
                  <span className="text-sm font-medium">
                    未知の店舗の区分確定（{setlistUnknowns.venues.length}件）
                  </span>
                  {setlistUnknowns.venues.map((name) => (
                    <div
                      key={name}
                      className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 shadow-sm"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {name}
                      </span>
                      <Toggle
                        ariaLabel={`${name} の母店区分`}
                        onLabel="母店"
                        offLabel="母店以外"
                        value={state.resolutions.venues[name] ?? false}
                        onChange={(isHome) => setVenueHome(name, isHome)}
                      />
                    </div>
                  ))}
                </div>
              ) : null}

              {setlistUnknowns.titles.length > 0 ? (
                <div className="grid gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    曲名の不一致（{setlistUnknowns.titles.length}件）
                    {unresolvedTitles > 0 ? (
                      <Badge variant="warning">未解決 {unresolvedTitles}件</Badge>
                    ) : null}
                  </span>
                  {setlistUnknowns.titles.map((t) => {
                    const res = state.resolutions.titles[t.csvTitle];
                    const hasCandidate = t.candidates.length > 0;
                    const options = [
                      ...(hasCandidate
                        ? [{ value: "match" as const, label: "候補に一致" }]
                        : []),
                      { value: "create_stub" as const, label: "新規スタブ作成" },
                      { value: "skip" as const, label: "スキップ" },
                    ];
                    return (
                      <div
                        key={t.csvTitle}
                        className="rounded-xl border border-border bg-card p-3 shadow-sm"
                      >
                        <div className="text-sm font-medium">
                          &quot;{t.csvTitle}&quot;
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {hasCandidate
                            ? `近似候補: ${t.candidates[0].title}`
                            : "近似候補: なし"}
                        </div>
                        <Segment
                          className="mt-2"
                          ariaLabel={`${t.csvTitle} の解決`}
                          value={
                            (res?.action ?? "") as TitleResolution["action"]
                          }
                          onChange={(action) =>
                            setTitleAction(
                              t.csvTitle,
                              action,
                              action === "match"
                                ? t.candidates[0]?.songId
                                : undefined,
                            )
                          }
                          options={options}
                        />
                      </div>
                    );
                  })}
                  {unresolvedTitles > 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="justify-start px-0"
                      onClick={bulkStubUnresolved}
                    >
                      未解決をすべてスタブ作成（一括）
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-10 flex-1"
              onClick={restart}
            >
              戻る
            </Button>
            <Button
              type="button"
              className="h-10 flex-1"
              disabled={busy}
              onClick={handleDryRun}
            >
              ドライラン実行
            </Button>
          </div>
        </div>
      ) : null}

      {/* ============ Step 3: ドライラン差分 ============ */}
      {state.step === 3 && state.dryRun ? (
        <div className="space-y-4">
          <span className="text-sm font-medium">
            取り込み内容（まだ保存されません）
          </span>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="min-w-full text-sm">
              <tbody>
                {DRY_RUN_ROWS.map(({ key, label }) => (
                  <tr key={key} className="border-t border-border first:border-t-0">
                    <td className="px-4 py-2.5">{label}</td>
                    <td className="px-4 py-2.5 text-right">
                      <strong>{state.dryRun![key] as number}</strong> 件
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {state.dryRun.unresolvedVenues > 0 ? (
            <div
              role="alert"
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300"
            >
              未解決の店舗が {state.dryRun.unresolvedVenues}{" "}
              件あります。コミットは失敗します。
            </div>
          ) : null}
          {state.dryRun.duplicateSessions > 0 ? (
            <div
              role="alert"
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300"
            >
              既存と重複するセッションが {state.dryRun.duplicateSessions} 件あります。
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-10 flex-1"
              onClick={() => patch({ step: 2 })}
            >
              戻る
            </Button>
            <Button
              type="button"
              className="h-10 flex-1"
              onClick={() => patch({ step: 4 })}
            >
              コミットへ進む
            </Button>
          </div>
        </div>
      ) : null}

      {/* ============ Step 4: コミット / 結果 ============ */}
      {state.step === 4 ? (
        <div className="space-y-4">
          {!state.commit ? (
            <>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <Checkbox
                  checked={recalc}
                  onCheckedChange={(v) => setRecalc(v === true)}
                  aria-label="取込後に has_played を再計算する"
                  className="mt-0.5"
                />
                <span>取込後に has_played（演奏経験）を再計算する</span>
              </label>
              <p className="text-xs text-muted-foreground">
                participated=1 の履歴がある曲を「コール可能」にします。
              </p>
              <Button
                type="button"
                className="h-10 w-full"
                disabled={busy}
                onClick={handleCommit}
              >
                コミット実行
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="h-10 w-full"
                disabled={busy}
                onClick={() => setDiscardOpen(true)}
              >
                このインポートを破棄
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-10 flex-1"
                  onClick={() => patch({ step: 3 })}
                >
                  戻る
                </Button>
              </div>
            </>
          ) : (
            <>
              <span className="text-sm font-medium">実行結果</span>
              <div className="rounded-xl border border-emerald-500/35 bg-card p-3 shadow-sm">
                <Badge variant="success">取込完了</Badge>
                <div className="mt-2 text-sm leading-7">
                  新規曲 {state.commit.songsCreated} ・ 更新{" "}
                  {state.commit.songsUpdated} ・ 新規店舗{" "}
                  {state.commit.venuesCreated}
                  <br />
                  新規セッション {state.commit.sessionsCreated} ・ 演奏記録{" "}
                  {state.commit.performancesCreated} ・ スタブ{" "}
                  {state.commit.stubsCreated} ・ スキップ{" "}
                  {state.commit.skippedRows}
                  <br />
                  has_played 再計算: {state.commit.hasPlayedRecalculated}
                  曲を「コール可能」に更新
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="h-10 w-full"
                onClick={restart}
              >
                新しいインポートを開始
              </Button>
            </>
          )}
        </div>
      ) : null}

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="このインポートを破棄しますか？"
        description="プレビュー中のジョブを破棄します。取り込みは行われません。"
        confirmLabel="破棄する"
        confirmVariant="destructive"
        onConfirm={handleDiscard}
        pending={busy}
      />
    </div>
  );
}
