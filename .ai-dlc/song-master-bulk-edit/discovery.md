---
intent: song-master-bulk-edit
created: 2026-07-15
status: active
---

# Discovery Log: 曲マスタの全曲一括編集（Google Sheets）＋黒本1難易度の叩き台

iteration intent（iterates_on: next-call-mvp）。前作で確立済みの曲マスタ／CSVインポート仕様を土台に、差分のみを記録する。本ログは本セッションでの実コード確認に基づく（サブエージェント再探索ではなく検証済み事実）。

## Previous Intent Context（next-call-mvp）
- 曲マスタ = Drizzle `songs` テーブル（`src/db/schema.ts:27-83`）。難易度という単一列は存在しない。
- unit-07 曲マスタ編集画面（1件ずつ編集UI, `src/components/master/song-edit-screen.tsx`）。
- unit-08 CSVインポート（`src/server/import/{preview,commit,dry-run}.ts`）。既存曲は title 一致で **更新**（`scripts/initial-migrate.ts` が commitImport で songsUpdated を返す実績）。
- `scripts/extract-excel.ts`（初回移行用 Excel→CSV）。移行時 is_standard/simple_form=0、listener/energy_level=3 の既定値で投入（`extract-excel.ts:423-428`）。

## Domain Model（今回の関与範囲）
### Song（曲マスター, `src/db/schema.ts:27-83`）
編集対象の全項目（= songs.csv インポート互換列, `extract-excel.ts:200-215`）:
- title (unique, 照合キー), song_key, form(AABA/ABAC/BLUES12/OTHER), composer,
  has_played, no_chart_ok, is_standard, simple_form, in_kurobon1,
  season(SPRING/SUMMER/AUTUMN/WINTER/ALL), listener_level(1-5), energy_level(1-5),
  genres(9種, `|`区切り), note
- needs_review はインポートCSVに列が無い＝CSV経路では更新不可（対象外）。
- Zod検証: `src/server/validation/songs.ts:24-41`（level は int 1-5）。

### 「攻め方」スライダー = 安全性軸（仕様§9.4）
- UI: `src/components/session/recommend-screen.tsx:391-393`（name="攻め方" 安全に行く↔攻める）。
- safety_score(0-10) = 2*is_standard + 3*no_chart_ok + 2*simple_form + min(play,5)*0.4 + min(call,3)/3（`src/engine/score.ts:50-59`, `src/db/seed.ts:57-71`）。
- 静的属性で効くのは is_standard/no_chart_ok/simple_form。難易度が高い曲ほど「攻め」寄り、という参考づけ。

## Data Sources
- **docs/やれる曲.xlsx [list]シート**（738行, ヘッダ行=3）: A列=Title（正）, O列「#1」="■"=黒本1（計227曲, R1式 countifs(...,"■")/227）。genre=W列, composer=X列, key=Z列, form=AA列, ready=E/done=F（has_played導出）。`scripts/extract-excel.ts` の LIST_ALIASES(`:234-243`) が検出ロジック。
- **現行DB**（SQLite, `src/db/client.ts` getDb()/DATABASE_PATH, 既定 ./data/next-call.db）。ローカルには未生成。本番はVPS /data/next-call.db。→ 生成は [list] 主・DB対応も実装。
- **既存インポート**（unit-08）: songs.csv を受け取り title 一致で更新。season は日本語「通年」等も受理（`extract-excel.ts:426`）、真偽は "1"/"0"、genres は `|` 区切り。※CSVパーサの受理トークンは実装時に `src/server/import/preview.ts` で確認する。
- **外部参照** thetrumpetschool.com「ジャズスタンダードバイブル トランペットで全部」: 全45記事・1記事約5曲・アルファベット順（#45="You..."系）・黒本1のほぼ全曲(約225)を網羅。難易度=初級-/初級/初級+/中級±/上級±（9段階）＋一言コメント。URL例 https://thetrumpetschool.com/2020/01/14/jazz-standard-bible45/。#1-#36 のURLはカテゴリのページ送りで発見が必要。

## Data Gaps / 決定事項
- ローカルDB不在 → 生成スクリプトは [list] フォールバックを主経路にしつつ getDb() 対応も実装。
- title は照合キーのため編集用シートでは保護（読み取り専用）。
- ジャンルは9列の✓で表現（複数選択をSheetsで扱いやすく）。
- コード値は日本語ラベル＋データ検証ドロップダウンで隠蔽（form/season/真偽/level）。編集後→変換スクリプトでラベル→コード解決。
- 難易度・コメント・攻め方目安は参考列（インポート対象外）。黒本1のみ付与。曲名正規化突合は `src/lib/normalize-title.ts` の normalizeTitle を流用。
- 45記事フェッチ（#1-#36のURL発見含む）が難易度データ収集の主作業。
