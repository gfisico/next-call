/**
 * 設定 API のリクエストスキーマ（置き場規約は common.ts のヘッダコメント参照）
 *
 * 既知キーのみ許可: SETTING_SEEDS（src/db/seed.ts）のキー集合から動的にスキーマを
 * 構築するため、シードにキーを追加すればここも自動追従する（陳腐化対策）。
 * 型検証はシード値の型（number / boolean / object）に合わせる。
 */
import { z } from "zod";
import { SETTING_SEEDS } from "@/db/seed";

function schemaForSeedValue(value: unknown): z.ZodType {
  switch (typeof value) {
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    default:
      // シードの残りは JSON オブジェクト（配列は現状なし。object のみ許可）
      return z.record(z.string(), z.unknown());
  }
}

const shape = Object.fromEntries(
  Object.entries(SETTING_SEEDS).map(([key, value]) => [
    key,
    schemaForSeedValue(value).optional(),
  ]),
);

/**
 * PUT /api/settings — { key: value, ... }（単一キーも複数キーも同じ形式）。
 * 未知キーは strict 違反で 400。
 */
export const settingsPutSchema = z
  .strictObject(shape)
  .refine((obj) => Object.values(obj).some((v) => v !== undefined), {
    message: "更新する設定キーを 1 つ以上指定してください",
  });

export type SettingsPutInput = z.infer<typeof settingsPutSchema>;
