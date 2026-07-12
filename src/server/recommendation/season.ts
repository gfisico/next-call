/**
 * 現在季節の判定（セッション日付 YYYY-MM-DD + 設定 engine.season_months）
 *
 * session_date は JST を正とする日付文字列（schema.ts 規約）なので、
 * 月の抽出は文字列パースで行う（タイムゾーン変換を挟まない）。
 * season_months が不正・欠損の場合は既定の区切り（3-5/6-8/9-11/12-2）へフォールバック。
 */
import type { Season } from "@/engine/types";

const SEASONS: Season[] = ["SPRING", "SUMMER", "AUTUMN", "WINTER"];

const DEFAULT_SEASON_MONTHS: Record<Season, number[]> = {
  SPRING: [3, 4, 5],
  SUMMER: [6, 7, 8],
  AUTUMN: [9, 10, 11],
  WINTER: [12, 1, 2],
};

function parseSeasonMonths(value: unknown): Record<Season, number[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_SEASON_MONTHS;
  }
  const obj = value as Record<string, unknown>;
  const out = {} as Record<Season, number[]>;
  const seen = new Set<number>();
  for (const season of SEASONS) {
    const months = obj[season];
    if (
      !Array.isArray(months) ||
      months.some((m) => typeof m !== "number" || !Number.isInteger(m) || m < 1 || m > 12)
    ) {
      return DEFAULT_SEASON_MONTHS;
    }
    for (const m of months as number[]) {
      if (seen.has(m)) return DEFAULT_SEASON_MONTHS; // 月の重複は不正
      seen.add(m);
    }
    out[season] = months as number[];
  }
  // 12ヶ月すべてがどこかの季節に属していること
  if (seen.size !== 12) return DEFAULT_SEASON_MONTHS;
  return out;
}

/**
 * セッション日付（YYYY-MM-DD）から現在季節を判定する。
 * 日付が不正な場合も既定区切り + 現在月では判定できないため、
 * 月が取れない場合は WINTER ではなく「通年扱いが無い」ことから安全に SPRING…とはせず、
 * 呼び出し側でバリデーション済み前提とし、パース不能時は例外を投げる。
 */
export function seasonForDate(sessionDate: string, seasonMonths: unknown): Season {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sessionDate);
  if (!m) {
    throw new Error(`不正なセッション日付です: ${sessionDate}`);
  }
  const month = Number(m[2]);
  if (month < 1 || month > 12) {
    throw new Error(`不正なセッション日付です: ${sessionDate}`);
  }
  const table = parseSeasonMonths(seasonMonths);
  for (const season of SEASONS) {
    if (table[season].includes(month)) return season;
  }
  // parseSeasonMonths が 12ヶ月網羅を保証するため到達しない
  throw new Error(`季節を判定できません: month=${month}`);
}
