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
 * 初心者向き判定（§8.2）: 難易度が低い（difficulty ≤ 2）。
 * difficulty=null（未設定）は「満たさない」扱い（安全側で除外）。
 */
export function isBeginnerFriendly(song: EngineSong): boolean {
  return song.difficulty !== null && song.difficulty <= 2;
}
