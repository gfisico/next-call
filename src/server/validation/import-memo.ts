/**
 * メモ一括移行 API のバリデーション（unit-02 要件7）
 *
 * - preview: 貼付テキストを受け解析結果を返す（DB 未書込）
 * - commit: プレビュー画面（unit-03）で **補正済みの完全な確定ペイロード** を受ける。
 *   commit はテキストを受け取らず再パースもしない（ユーザー補正が失われないことを構造的に保証）。
 * フィールド名は camelCase（src/server/validation/common.ts の規約）。
 */
import { z } from "zod";

/** POST /api/sessions/import-memo/preview — 貼付テキスト */
export const memoPreviewSchema = z.object({
  text: z.string().min(1, "取込テキストが空です"),
});

export type MemoPreviewInput = z.infer<typeof memoPreviewSchema>;

// --- commit（確定ペイロード） -------------------------------------------------

const venueRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), id: z.number().int().positive() }),
  z.object({
    kind: z.literal("new"),
    name: z.string().min(1),
    isHome: z.boolean().default(false),
  }),
]);

const songRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), id: z.number().int().positive() }),
  z.object({
    kind: z.literal("new"),
    title: z.string().min(1),
    needsReview: z.boolean().default(true),
  }),
]);

const memoPerformanceSchema = z.object({
  order: z.number().int(),
  songRef: songRefSchema,
  frontInstruments: z.array(z.string().min(1)).default([]),
  participated: z.boolean().default(false),
  instrument: z.enum(["SAX", "PIANO", "NONE"]).default("NONE"),
  calledByMe: z.boolean().default(false),
  noChart: z.boolean().default(false),
  note: z.string().nullable().optional(),
});

const memoSessionSchema = z.object({
  sessionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式で指定してください"),
  venue: venueRefSchema,
  listenerCount: z.number().int().min(0).nullable().optional(),
  hostInstrumentCode: z.string().min(1).nullable().optional(),
  participants: z
    .array(
      z.object({
        instrumentCode: z.string().min(1),
        count: z.number().int().min(0),
      }),
    )
    .default([]),
  performances: z.array(memoPerformanceSchema).default([]),
});

export const memoCommitSchema = z.object({
  sessions: z.array(memoSessionSchema).min(1, "取込対象セッションがありません"),
});

export type MemoCommitInput = z.infer<typeof memoCommitSchema>;
export type MemoCommitSession = z.infer<typeof memoSessionSchema>;
