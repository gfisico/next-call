/**
 * 推薦エンジンのエントリポイント。全ステージを合成する純関数。
 * DB・fetch・Date.now()・Math.random() 不使用。
 */
import { generateConditionalCandidates } from "./conditional";
import { filterExcluded } from "./exclude";
import { annotatePendingSongs } from "./pending";
import { generateReasons } from "./reasons";
import { applyRepeatPenalties } from "./repeat";
import { scoreSong } from "./score";
import { selectCandidates } from "./select";
import type {
  EngineConfig,
  EngineInput,
  EngineResult,
  ScoredSong,
} from "./types";

export function recommend(
  input: EngineInput,
  config: EngineConfig,
  seed: number,
): EngineResult {
  // Stage 1: 完全除外
  const passed = filterExcluded(input, config);

  // Stage 2–4: スコアリング → Stage 5: 繰り返し減点
  const scores = applyRepeatPenalties(
    new Map(passed.map((song) => [song.id, scoreSong(song, input, config)])),
    input,
    config,
  );
  const scoredSongs: ScoredSong[] = passed.map((song) => ({
    song,
    score: scores.get(song.id) ?? 0,
  }));

  // Stage 6–7: 候補集団の作成 + 重み付きランダム抽出
  const { selected, isSparse } = selectCandidates(scoredSongs, config, seed);

  // Stage 8: 推薦理由生成（保留曲と重複した候補には「保留中」バッジ §16.4）
  const pendingIds = new Set(input.pendingSongIds);
  const candidates = selected.map((s) => ({
    songId: s.song.id,
    score: s.score,
    reasons: generateReasons(s.song, input, config),
    isPending: pendingIds.has(s.song.id),
  }));

  // Stage 9: 条件別候補（horns/beginner が UNKNOWN のときのみブランチ実行）
  const conditionalCandidates = generateConditionalCandidates(
    input,
    config,
    seed,
    candidates.map((c) => c.songId),
  );

  // 保留曲の注釈（スコア不干渉・無条件表示 §16）
  const pendingSongs = annotatePendingSongs(input, config);

  return { candidates, conditionalCandidates, pendingSongs, isSparse };
}

export * from "./types";
