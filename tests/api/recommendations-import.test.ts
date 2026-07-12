/**
 * 基準9（unit-04 / unit-08 連携）: インポート済み履歴が登場回数・久しぶり度の
 * 集計に反映されることを CSV インポート API 経由で検証する結合テスト scaffold。
 *
 * TODO(unit-08): unit-08（CSV インポート API）完成後に IMPORT_ROUTE_READY を
 * true にして（または存在チェックを外して）このテストを有効化すること。
 * DB レベルの同等検証（過去 sessions/performances の直接 INSERT が集計へ反映される
 * こと）は tests/api/recommendation-input.test.ts「インポート相当の履歴反映」で
 * 実装済み。ここでは unit-08 の実 API を通した end-to-end の再検証を行う。
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** unit-08 のインポート Route（src/app/api/import/route.ts 想定）が存在するか */
function importRouteExists(): boolean {
  return existsSync(
    path.join(process.cwd(), "src", "app", "api", "import", "route.ts"),
  );
}

describe("インポート済み履歴の集計反映（基準9 / unit-08 結合）", () => {
  it.skipIf(true /* IMPORT_ROUTE_READY: unit-08 完成後に有効化 */)(
    "CSV インポート API 経由の履歴が登場回数・久しぶり度に反映される",
    async () => {
      // ---- unit-08 完成後の実装手順（scaffold） ----
      // 1. setupTestDb() + 曲・店舗・ACTIVE セッションを API で作成
      // 2. POST /api/import に過去セッション履歴 CSV（同曲を含む）を投入
      // 3. buildEngineInput（または POST recommendations 経由）で
      //    stats[songId].appearanceCount がインポート行数分増えること、
      //    daysSinceLastPlayed がインポートした participated 行の日付から
      //    計算されることをアサートする
      //    （期待値は tests/api/recommendation-input.test.ts の
      //     「インポート相当の履歴反映」と同一のロジックで算出）
      expect(importRouteExists()).toBe(true);
      throw new Error("unit-08 完成後に実装する（上記手順を参照）");
    },
  );

  it("scaffold の前提: unit-08 のインポート Route は未実装（実装されたら上のテストを有効化）", () => {
    // unit-08 がマージされ Route が存在するようになったら、この前提テストは
    // 失敗する → skipIf を外して本テストを有効化せよ、という backpressure。
    expect(importRouteExists()).toBe(false);
  });
});
