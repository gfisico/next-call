"use client";

/**
 * 曲編集 "/songs/[id]"（新規は "/songs/new"）。
 * - 全属性フォーム（ジャンル複数選択含む）。新規=POST / 既存=PATCH。
 * - needs_review 解除（「属性入力完了」チェック→保存時に needsReview:false）。
 * - 「保存して次の未整備曲へ」で連続補完。
 * - 削除は ConfirmDialog。参照中(409)は「履歴があるため削除できません」を表示（criterion 3）。
 *
 * 単一曲 GET API は無いため、一覧（useSongs）から id で引く。
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/session/confirm-dialog";
import { Segment } from "@/components/session/segment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import {
  ApiClientError,
  createSong,
  deleteSong,
  updateSong,
} from "@/lib/api/client";
import { useSongs } from "@/lib/api/hooks";
import type {
  Genre,
  Season,
  Song,
  SongForm,
  SongUpsertPayload,
} from "@/lib/api/types";
import { FORMS, GENRES, SEASONS } from "@/lib/master-labels";

interface SongEditScreenProps {
  /** 未指定なら新規作成モード */
  songId?: number;
}

interface FormState {
  title: string;
  songKey: string;
  composer: string;
  form: SongForm;
  hasPlayed: boolean;
  noChartOk: boolean;
  isStandard: boolean;
  simpleForm: boolean;
  inKurobon1: boolean;
  season: Season;
  listenerLevel: number;
  energyLevel: number;
  genreTags: Genre[];
  note: string;
}

const DEFAULT_FORM: FormState = {
  title: "",
  songKey: "",
  composer: "",
  form: "OTHER",
  hasPlayed: false,
  noChartOk: false,
  isStandard: false,
  simpleForm: false,
  inKurobon1: false,
  season: "ALL",
  listenerLevel: 3,
  energyLevel: 3,
  genreTags: [],
  note: "",
};

function fromSong(song: Song): FormState {
  return {
    title: song.title,
    songKey: song.songKey ?? "",
    composer: song.composer ?? "",
    form: song.form,
    hasPlayed: song.hasPlayed,
    noChartOk: song.noChartOk,
    isStandard: song.isStandard,
    simpleForm: song.simpleForm,
    inKurobon1: song.inKurobon1,
    season: song.season,
    listenerLevel: song.listenerLevel,
    energyLevel: song.energyLevel,
    genreTags: song.genreTags as Genre[],
    note: song.note ?? "",
  };
}

const LEVELS = ["1", "2", "3", "4", "5"] as const;

const CHECKS: ReadonlyArray<{ key: keyof FormState; label: string }> = [
  { key: "hasPlayed", label: "演奏経験あり（コール可能）" },
  { key: "noChartOk", label: "譜面なし対応可" },
  { key: "isStandard", label: "超定番" },
  { key: "simpleForm", label: "構成が単純" },
  { key: "inKurobon1", label: "黒本1曲載" },
];

const inputClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function SongEditScreen({ songId }: SongEditScreenProps) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const isNew = songId === undefined;

  // 単一 GET が無いため一覧から取得。既存編集は全件（current を含む）、
  // 新規は needsReview のみ（「次の未整備曲へ」導線用の軽量クエリ）。
  const { songs, isLoading, error } = useSongs(
    isNew ? { needsReview: true } : {},
  );
  const current = useMemo(
    () => (isNew ? null : (songs.find((s) => s.id === songId) ?? null)),
    [isNew, songs, songId],
  );

  const [formState, setFormState] = useState<FormState>(DEFAULT_FORM);
  const [initialized, setInitialized] = useState(isNew);
  const [markComplete, setMarkComplete] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState(false);

  // 既存曲を読み込んだら 1 度だけ初期化
  useEffect(() => {
    if (!isNew && !initialized && current) {
      setFormState(fromSong(current));
      setInitialized(true);
    }
  }, [isNew, initialized, current]);

  const nextReview = useMemo(
    () => songs.find((s) => s.needsReview && s.id !== songId) ?? null,
    [songs, songId],
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setFormState((s) => ({ ...s, [key]: value }));

  const toggleGenre = (g: Genre) =>
    setFormState((s) => ({
      ...s,
      genreTags: s.genreTags.includes(g)
        ? s.genreTags.filter((x) => x !== g)
        : [...s.genreTags, g],
    }));

  function buildPayload(): SongUpsertPayload {
    const trimmedKey = formState.songKey.trim();
    const trimmedComposer = formState.composer.trim();
    const trimmedNote = formState.note.trim();
    return {
      title: formState.title.trim(),
      songKey: trimmedKey === "" ? null : trimmedKey,
      composer: trimmedComposer === "" ? null : trimmedComposer,
      form: formState.form,
      hasPlayed: formState.hasPlayed,
      noChartOk: formState.noChartOk,
      isStandard: formState.isStandard,
      simpleForm: formState.simpleForm,
      inKurobon1: formState.inKurobon1,
      season: formState.season,
      listenerLevel: formState.listenerLevel,
      energyLevel: formState.energyLevel,
      genreTags: formState.genreTags,
      note: trimmedNote === "" ? null : trimmedNote,
      // 「属性入力完了」チェック時は needs_review を解除
      needsReview: !markComplete,
    };
  }

  /** 一覧系 SWR キーをまとめて再検証 */
  const revalidateSongs = () =>
    mutate(
      (key) => typeof key === "string" && key.startsWith("/api/songs"),
      undefined,
      { revalidate: true },
    );

  /** 保存。成功時は saved song を返す（失敗時 null） */
  async function save(): Promise<Song | null> {
    if (formState.title.trim() === "") {
      setTitleError(true);
      toast.error("曲名を入力してください");
      return null;
    }
    setTitleError(false);
    setSaving(true);
    try {
      const payload = buildPayload();
      const saved = isNew
        ? await createSong(payload)
        : await updateSong(songId as number, payload);
      await revalidateSongs();
      toast.success("保存しました");
      return saved;
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409) {
        toast.error("同名の曲が既に存在します");
      } else {
        toast.error("保存に失敗しました");
      }
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    const saved = await save();
    if (saved) router.push("/songs");
  }

  async function handleSaveNext() {
    const saved = await save();
    if (!saved) return;
    if (nextReview) {
      router.push(`/songs/${nextReview.id}`);
    } else {
      toast.success("未整備の曲は残っていません");
      router.push("/songs");
    }
  }

  async function handleDelete() {
    if (isNew) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteSong(songId as number);
      await revalidateSongs();
      toast.success("削除しました");
      setConfirmOpen(false);
      router.push("/songs");
    } catch (e) {
      setConfirmOpen(false);
      if (e instanceof ApiClientError && e.status === 409) {
        setDeleteError("この曲には演奏履歴があるため削除できません。");
        toast.error("履歴があるため削除できません");
      } else {
        toast.error("削除に失敗しました");
      }
    } finally {
      setDeleting(false);
    }
  }

  // 既存編集で読み込み中/欠落
  if (!isNew && !initialized) {
    if (error) {
      return (
        <p className="text-sm text-destructive">曲の取得に失敗しました。</p>
      );
    }
    if (isLoading) {
      return <p className="text-sm text-muted-foreground">読み込み中…</p>;
    }
    if (!current) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">曲が見つかりません。</p>
          <Link
            href="/songs"
            className="inline-flex text-sm underline underline-offset-4"
          >
            一覧へ戻る
          </Link>
        </div>
      );
    }
  }

  const busy = saving || deleting;

  return (
    <div className="space-y-4">
      {/* ヘッダ */}
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/songs" aria-label="一覧へ戻る">
            ‹ 戻る
          </Link>
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">
          {isNew ? "曲を追加" : "曲を編集"}
        </h1>
        {!isNew && current?.needsReview ? (
          <Badge variant="warning">属性未整備</Badge>
        ) : null}
      </div>

      {/* 曲名 */}
      <div className="grid gap-2">
        <label htmlFor="song-title" className="text-sm font-medium">
          曲名（必須）
        </label>
        <Input
          id="song-title"
          className={inputClass}
          value={formState.title}
          aria-invalid={titleError}
          onChange={(e) => set("title", e.target.value)}
          placeholder="曲名"
        />
      </div>

      {/* キー・作曲者 */}
      <div className="flex gap-3">
        <div className="grid flex-1 gap-2">
          <label htmlFor="song-key" className="text-sm font-medium">
            黒本キー
          </label>
          <Input
            id="song-key"
            className={inputClass}
            value={formState.songKey}
            onChange={(e) => set("songKey", e.target.value)}
            placeholder="F"
          />
        </div>
        <div className="grid flex-1 gap-2">
          <label htmlFor="song-composer" className="text-sm font-medium">
            作曲者
          </label>
          <Input
            id="song-composer"
            className={inputClass}
            value={formState.composer}
            onChange={(e) => set("composer", e.target.value)}
            placeholder="任意"
          />
        </div>
      </div>

      {/* 構成 */}
      <div className="grid gap-2">
        <span className="text-sm font-medium">構成</span>
        <Segment
          ariaLabel="構成"
          value={formState.form}
          onChange={(v) => set("form", v)}
          options={FORMS.map((f) => ({ value: f.value, label: f.label }))}
        />
      </div>

      {/* チェック群 */}
      <div className="grid gap-1">
        {CHECKS.map(({ key, label }) => (
          <label
            key={key}
            className="flex cursor-pointer items-center gap-2 py-1.5 text-sm"
          >
            <Checkbox
              checked={formState[key] as boolean}
              onCheckedChange={(v) => set(key, v === true)}
              aria-label={label}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>

      {/* 季節 */}
      <div className="grid gap-2">
        <span className="text-sm font-medium">季節</span>
        <Segment
          ariaLabel="季節"
          value={formState.season}
          onChange={(v) => set("season", v)}
          options={SEASONS.map((s) => ({ value: s.value, label: s.label }))}
        />
      </div>

      {/* レベル */}
      <div className="grid gap-2">
        <span className="text-sm font-medium">リスナー受け度</span>
        <Segment
          ariaLabel="リスナー受け度"
          value={String(formState.listenerLevel)}
          onChange={(v) => set("listenerLevel", Number(v))}
          options={LEVELS.map((n) => ({ value: n, label: n }))}
        />
      </div>
      <div className="grid gap-2">
        <span className="text-sm font-medium">盛り上がり度</span>
        <Segment
          ariaLabel="盛り上がり度"
          value={String(formState.energyLevel)}
          onChange={(v) => set("energyLevel", Number(v))}
          options={LEVELS.map((n) => ({ value: n, label: n }))}
        />
      </div>

      {/* ジャンル（複数選択） */}
      <div className="grid gap-2">
        <span className="text-sm font-medium">ジャンルタグ（複数選択可）</span>
        <div className="flex flex-wrap gap-2">
          {GENRES.map((g) => (
            <Chip
              key={g}
              selected={formState.genreTags.includes(g)}
              onClick={() => toggleGenre(g)}
            >
              {g}
            </Chip>
          ))}
        </div>
      </div>

      {/* メモ */}
      <div className="grid gap-2">
        <label htmlFor="song-note" className="text-sm font-medium">
          メモ
        </label>
        <textarea
          id="song-note"
          value={formState.note}
          onChange={(e) => set("note", e.target.value)}
          placeholder="任意メモ…"
          rows={3}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      {/* 属性完了（needs_review 解除） */}
      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
        <Checkbox
          checked={markComplete}
          onCheckedChange={(v) => setMarkComplete(v === true)}
          aria-label="属性の入力が完了しましたか"
          className="mt-0.5"
        />
        <span>属性の入力が完了しましたか？（保存時に「属性未整備」を解除）</span>
      </label>

      {/* アクション */}
      <div className="space-y-2">
        <Button
          type="button"
          className="h-10 w-full"
          disabled={busy}
          onClick={handleSave}
        >
          保存
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-10 w-full"
          disabled={busy}
          onClick={handleSaveNext}
        >
          保存して次の未整備曲へ
        </Button>
        {!isNew ? (
          <Button
            type="button"
            variant="destructive"
            className="h-10 w-full"
            disabled={busy}
            onClick={() => setConfirmOpen(true)}
          >
            この曲を削除
          </Button>
        ) : null}
      </div>

      {/* 削除 409 エラー（criterion 3） */}
      {deleteError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <strong className="font-semibold">削除できません: </strong>
          {deleteError}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="この曲を削除しますか？"
        description="この操作は取り消せません。"
        confirmLabel="削除する"
        confirmVariant="destructive"
        onConfirm={handleDelete}
        pending={deleting}
      />
    </div>
  );
}
