/**
 * 推薦エンジンのエントリポイント。全ステージを合成する純関数。
 * DB・fetch・Date.now()・Math.random() 不使用。
 */
import type { EngineConfig, EngineInput, EngineResult } from "./types";

export function recommend(
  _input: EngineInput,
  _config: EngineConfig,
  _seed: number,
): EngineResult {
  throw new Error("not implemented");
}

export * from "./types";
