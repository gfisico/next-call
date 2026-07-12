/**
 * Stage 9: 条件別候補（§8/§15.2）
 * - horns=UNKNOWN → ONE / MULTI、beginner=UNKNOWN → NONE / PRESENT の各ブランチで再実行
 * - 各軸を独立に分岐し、分岐しない側の軸は UNKNOWN のまま（除外・減点なし）維持
 * - 両軸 UNKNOWN でもブランチは最大4本。組み合わせブランチ（1管×初心者あり等）は生成しない
 * - 各ブランチの最上位曲（Stage 5 適用後の最高スコア）が通常候補と重複しない場合のみ
 *   ラベル付きで追加。Stage 5 の履歴減点は通常候補と共有する
 */
import { filterExcluded } from "./exclude";
import { applyRepeatPenalties } from "./repeat";
import { generateReasons } from "./reasons";
import { scoreSong } from "./score";
import type {
  ConditionalBranch,
  ConditionalCandidate,
  EngineConditions,
  EngineConfig,
  EngineInput,
} from "./types";

interface BranchDef {
  branch: ConditionalBranch;
  label: string;
  patch: Partial<EngineConditions>;
}

const HORNS_BRANCHES: BranchDef[] = [
  { branch: "HORNS_ONE", label: "1管なら", patch: { horns: "ONE" } },
  { branch: "HORNS_MULTI", label: "複数管なら", patch: { horns: "MULTI" } },
];

const BEGINNER_BRANCHES: BranchDef[] = [
  { branch: "BEGINNER_NONE", label: "初心者がいないなら", patch: { beginner: "NONE" } },
  {
    branch: "BEGINNER_PRESENT",
    label: "初心者が参加するなら",
    patch: { beginner: "PRESENT" },
  },
];

export function generateConditionalCandidates(
  input: EngineInput,
  config: EngineConfig,
  _seed: number,
  normalCandidateIds: number[],
): ConditionalCandidate[] {
  // 各軸を独立に分岐（組み合わせブランチは生成しない）。既知の軸は分岐しない
  const branches: BranchDef[] = [
    ...(input.conditions.horns === "UNKNOWN" ? HORNS_BRANCHES : []),
    ...(input.conditions.beginner === "UNKNOWN" ? BEGINNER_BRANCHES : []),
  ];
  if (branches.length === 0) return [];

  const normalIds = new Set(normalCandidateIds);
  const results: ConditionalCandidate[] = [];

  for (const def of branches) {
    // 分岐しない側の軸は入力値（UNKNOWN のままの通常候補ロジック）を維持する
    const branchInput: EngineInput = {
      ...input,
      conditions: { ...input.conditions, ...def.patch },
    };

    const passed = filterExcluded(branchInput, config);
    if (passed.length === 0) continue;

    const scores = applyRepeatPenalties(
      new Map(passed.map((song) => [song.id, scoreSong(song, branchInput, config)])),
      branchInput,
      config,
    );

    // ブランチの最上位曲（同点は曲 ID 昇順で決定的に）
    let top = passed[0];
    for (const song of passed) {
      if ((scores.get(song.id) ?? -Infinity) > (scores.get(top.id) ?? -Infinity)) {
        top = song;
      }
    }

    // 通常候補と重複する場合は追加しない（§8.1/§15.2）
    if (normalIds.has(top.id)) continue;

    results.push({
      songId: top.id,
      score: scores.get(top.id) ?? 0,
      reasons: generateReasons(top, branchInput, config),
      branch: def.branch,
      label: def.label,
    });
  }

  return results;
}
