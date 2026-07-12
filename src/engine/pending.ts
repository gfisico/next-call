/**
 * 保留曲の注釈（仕様§16）
 * - スコアに一切影響しない。無条件で全保留曲を返す（完全除外該当でも隠さない）
 * - 警告バッジ: 当日演奏済み / 直前曲と同じ構成 / 黒本1条件外 / 編成に合いにくい
 */
import type { EngineConfig, EngineInput, PendingAnnotation } from "./types";

export function annotatePendingSongs(
  _input: EngineInput,
  _config: EngineConfig,
): PendingAnnotation[] {
  throw new Error("not implemented");
}
