/**
 * 複数ステージで共有する述語。
 * 属性 null の扱い（仕様の安全側規則）をコードとして一箇所に固定する。
 */
import type { EngineSong } from "./types";

/**
 * 両値が既知（非 null）かつ等しいときのみ true。
 * null は「同じ」とみなさない（同構成§12.1・同キー§12.2・同作曲者§12.6 共通の規則）。
 */
export function sameNonNull<T>(a: T | null, b: T | null): boolean {
  return a !== null && b !== null && a === b;
}

/**
 * 初心者対応の AND 条件（§8.2）: 超定番 かつ 譜面なし対応可 かつ 構成が単純。
 * 属性 null は「満たさない」扱い（安全側）。
 */
export function isBeginnerFriendly(song: EngineSong): boolean {
  return (
    song.isStandard === true && song.noChartOk === true && song.simpleForm === true
  );
}
