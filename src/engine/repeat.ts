/**
 * Stage 5: 繰り返し減点（§14.3–14.4）
 * - 前回リクエスト提示曲 −12 / 直近5リクエスト(30日) −6
 * - 同一 condition_signature 3回以上 追加 −6 / 前回提示ジャンル −3
 * - Stage 1–3 通過曲数（= scores のエントリ数）< relax_pool_threshold で全て半減
 *
 * 純関数: 入力 Map を破壊せず、新しい Map を返す。
 */
import type { EngineConfig, EngineInput } from "./types";

/** §14.3「同一条件で3回以上提示」の回数閾値（仕様定数） */
const SAME_SIGNATURE_THRESHOLD = 3;

export function applyRepeatPenalties(
  scores: Map<number, number>,
  input: EngineInput,
  config: EngineConfig,
): Map<number, number> {
  const { history } = input;
  const penalties = config.repeatPenalties;

  // §14.3 緩和: 通過曲数 < relax_pool_threshold なら全減点を半減
  // （強い条件指定で候補が少ない場合は多様性より条件適合を優先 §22-11）
  const factor = scores.size < config.relaxPoolThreshold ? 0.5 : 1;

  const lastRequest = new Set(history.lastRequestSongIds);
  const recent = new Set(history.recentSongIds);
  const lastGenres = new Set(history.lastRequestGenres);
  const genresById = new Map(input.songs.map((s) => [s.id, s.genres]));

  const out = new Map<number, number>();
  for (const [songId, score] of scores) {
    let penalty = 0;

    // 前回リクエストで提示した曲
    if (lastRequest.has(songId)) penalty += penalties.lastRequest;

    // 直近リクエスト（repeat_window_days 以内、セッション横断）で提示した曲
    if (recent.has(songId)) penalty += penalties.recentRequests;

    // 同一 condition_signature で3回以上提示した曲（追加減点）
    if ((history.sameSignatureCounts[songId] ?? 0) >= SAME_SIGNATURE_THRESHOLD) {
      penalty += penalties.sameSignature;
    }

    // §14.4 前回リクエスト候補に含まれた特殊ジャンルを持つ曲（ジャンル繰り返し抑制）
    const genres = genresById.get(songId) ?? [];
    if (genres.some((g) => lastGenres.has(g))) penalty += penalties.genreRepeat;

    out.set(songId, score - penalty * factor);
  }
  return out;
}
