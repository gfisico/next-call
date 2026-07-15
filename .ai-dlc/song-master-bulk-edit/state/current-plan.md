# current-plan: unit-01-difficulty-attribute

Strategy B（段階的削除）で進行。difficulty を全レイヤに追加し、simpleForm の削除は blast radius ゼロの write/validation 契約（songFields）のみ。read/engine 型（api Song / EngineSong）では simpleForm を @deprecated として残置（実撤去は unit-02/07）。DB列 simple_form は物理保持。

## 変更対象
1. src/db/schema.ts: songs に `difficulty: integer("difficulty")`（nullable）追加。simpleForm 定義に @deprecated コメント（列は残す）。
2. マイグレーション 0003: `npm run db:generate` で `ALTER TABLE songs ADD difficulty integer;` を生成（rename 誤検出注意）。`npm run db:migrate` で適用。
3. src/server/validation/songs.ts: songFields に `difficulty: z.number().int().min(1).max(5).nullable()` 追加、`simpleForm: z.boolean()` 削除。create/update は .partial() 維持。
4. src/lib/api/types.ts: Song / SongAttributes に `difficulty: number | null` 追加。simpleForm は残置（@deprecated）。
5. src/engine/types.ts: EngineSong に `difficulty: number | null` 追加。simpleForm 残置（@deprecated）。
6. src/server/recommendation/build-input.ts: toEngineSong に `difficulty: song.difficulty` 追加。simpleForm 行は残置。
7. src/server/repositories/songs.ts: コード変更なし（$inferSelect/スプレッドで自動 pass-through、typecheck/test で確認）。
8-10. テスト/フィクスチャ: difficulty は必須プロパティのため、tsc が指摘する Song/EngineSong リテラル（tests/engine/helpers.ts makeSong、tests/components/helpers/fake-server.ts、一部 component テスト）に `difficulty: null` を追加。

## 検証
- npm run typecheck / lint / test / build を全て緑にする。
- migration 生成物を目視（additive・nullable・simple_form 不変）。

## 既知トレードオフ
- Success Criteria #3 の「simpleForm が無い」は本ユニットでは EngineSong/api Song に @deprecated 残置のため未達（意図的な段階化）。統合検証で最終確認。unit-01 の Notes/Risks が段階的撤去を明示的に許容している。
