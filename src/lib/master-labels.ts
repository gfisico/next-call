/**
 * 曲マスターの表示ラベル（UI 側の唯一の情報源）。
 * 値（enum）はサーバ契約（src/lib/api/types.ts・GENRE_TAG_NAMES）に一致させる。
 */
import type { Genre, Season, SongForm } from "@/lib/api/types";

/** ジャンル・特徴 固定9種（server GENRE_TAG_NAMES と同順） */
export const GENRES: readonly Genre[] = [
  "バラード",
  "ボサノバ",
  "3拍子",
  "モード",
  "ファンク",
  "ブルース",
  "歌もの",
  "循環",
  "キメが多い曲",
];

export const SEASONS: ReadonlyArray<{ value: Season; label: string }> = [
  { value: "SPRING", label: "春" },
  { value: "SUMMER", label: "夏" },
  { value: "AUTUMN", label: "秋" },
  { value: "WINTER", label: "冬" },
  { value: "ALL", label: "通年" },
];

export const seasonLabel = (s: Season): string =>
  SEASONS.find((x) => x.value === s)?.label ?? s;

export const FORMS: ReadonlyArray<{ value: SongForm; label: string }> = [
  { value: "AABA", label: "AABA" },
  { value: "ABAC", label: "ABAC" },
  { value: "BLUES12", label: "12小節ブルース" },
  { value: "OTHER", label: "その他" },
];

export const formLabel = (f: SongForm): string =>
  FORMS.find((x) => x.value === f)?.label ?? f;
