# 曲マスタ一括編集ワークフロー（Google Sheets 経由）

全曲・全編集項目（difficulty 含む / simple_form 除外）を Google Sheets で一括編集し、
既存の CSV インポートウィザードで取り込むための手順書（unit-06）。

人が触る面（日本語ラベル + ドロップダウン + 9列✓ジャンル + 曲名保護）と、システムが
取り込む面（`songs.csv` / snake_case ヘッダ）を分離する。コードの暗記は不要。

---

## 概要

```
[生成] npm run master:export   →  song-master-edit.xlsx（編集用・ドロップダウン付き）
   ↓ Google Drive へアップロード → Google Sheets で開く
[編集] Sheets 上でドロップダウン選択・9列✓・difficulty 記入（曲名列・参考列は触らない）
   ↓ .xlsx でダウンロード
[変換] npm run master:csv <dl.xlsx>  →  songs.csv（インポート互換・不正値は行番号で中断）
   ↓
[取込] 既存インポートウィザードで songs.csv を取り込む（title 一致で全曲更新）
```

---

## 前提

- Node / npm が使えること（`npm ci` 済み）。
- 参照データ `docs/reference/kurobon1-difficulty.json`（黒本1曲の難易度叩き台）。
- 現在値ソースは2経路:
  - `--source list`（既定）: `docs/やれる曲.xlsx` から抽出（ブートストラップ用）。
  - `--source db`: 現行 DB から現在値（`DATABASE_PATH` 指定）。
- 列契約の単一真実源は `src/server/validation/import-headers.ts` の `SONGS_CSV_HEADERS`。
  9ジャンル正式名は `src/db/seed.ts` の `GENRE_TAG_NAMES`、曲名照合は
  `src/lib/normalize-title.ts`。

---

## Step 1. 編集用 xlsx を生成する

```bash
# ブートストラップ（DB がまだ空 / やれる曲.xlsx から起こす）
npm run master:export -- --source list --in "docs/やれる曲.xlsx" --out docs/song-master-edit.xlsx

# 既に DB に取り込み済みで「現在値」を編集したい場合
DATABASE_PATH=./data/next-call.db npm run master:export -- --source db --out docs/song-master-edit.xlsx
```

主な違い:

| 項目 | `--source list` | `--source db` |
| --- | --- | --- |
| difficulty | 未設定（null）で出力 | DB の現在値 |
| season | 通年（ALL）固定 | DB の現在値 |
| listener_level / energy_level | 3（既定） | DB の現在値 |
| has_played / in_kurobon1 / genres 等 | やれる曲.xlsx 由来 | DB の現在値 |

生成される `master` シートの列構成（左→右）:

1. **編集列（スカラー13列）**: 曲名 / キー / 構成 / 作曲者 / 演奏経験 / 譜面なし可 /
   超定番 / 難易度 / 黒本1掲載 / 季節 / リスナー向け度 / 盛り上がり度 / メモ
2. **ジャンル9列**: バラード / ボサノバ / 3拍子 / モード / ファンク / ブルース / 歌もの /
   循環 / キメが多い曲（各列 `✓` で該当）
3. **参考3列（インポート対象外）**: 演奏難易度(叩き台) / 難易度コメント / 攻め方の目安
   （黒本1曲に `normalizeTitle` 突合で自動記入。非黒本1は空）
4. **隠し列 `__title_key`**: 曲名の照合キー（触らない・非表示）

ログに「◯曲」「参考列付与: ◯曲」が出る。

---

## Step 2. Google Drive にアップロードする

1. `docs/song-master-edit.xlsx` を Google Drive にアップロード。
2. Google スプレッドシートとして開く（右クリック →「アプリで開く」→「Google スプレッドシート」）。
3. **ドロップダウン保持の確認**: 構成・季節・難易度・各真偽・9ジャンル列のセルを選ぶと
   ▼ のドロップダウンが出ることを確認する（出ない場合は「xlsx として」開き直す。
   .xlsx のデータ検証は Sheets 取り込みで list 型ドロップダウンとして保持される）。

---

## Step 3. Google Sheets で編集する

- **ドロップダウンから選ぶ**（手打ち禁止・コード暗記不要）:
  - 構成 = AABA / ABAC / ブルース(12小節) / その他
  - 季節 = 春 / 夏 / 秋 / 冬 / 通年
  - 難易度 = 1〜5 / 未設定
  - リスナー向け度・盛り上がり度 = 1〜5
  - 真偽（演奏経験 / 譜面なし可 / 超定番 / 黒本1掲載）= `✓` または空
- **9ジャンル列**は該当ジャンルの列に `✓`（複数可）。
- **曲名列（薄いグレー）は触らない**。曲名は照合キー。改名は Step 5 でエラーになる。
- **参考3列は判定材料**として見るだけ（編集しても取り込まれない）。
  例: 「演奏難易度(叩き台)=4 / 攻め方の目安=上級-」を見て difficulty・超定番を判断する。
- 隠し列 `__title_key` は表示しない・編集しない。

---

## Step 4. ダウンロードする

編集が終わったら「ファイル」→「ダウンロード」→「Microsoft Excel (.xlsx)」で保存する。

---

## Step 5. songs.csv へ変換する

```bash
npm run master:csv -- ~/Downloads/song-master-edit.xlsx --out songs.csv
```

- 左側編集列のみを読み、ラベル→コードを解決。9ジャンル列は `genres` パイプ列へ合成。
  参考3列は読まない。
- **不正値は行番号付きで検出し、1件でもあれば CSV を出さず中断**する（黙って壊さない）。
  検出対象:
  - 未知の構成 / 季節ラベル
  - difficulty / リスナー向け度 / 盛り上がり度 が 1〜5 の範囲外・非整数
  - 未知の真偽値（`✓` / 空 以外）
  - 未知のジャンル列見出し
  - 曲名（`__title_key`）の改変
- エラー例:

  ```
  [master-csv] 2 件のエラーを検出しました。CSV は出力しません。
  [行12] 難易度（difficulty）は 1〜5 または未設定で指定してください（受領: "9"）
  [行30] 曲名（照合キー __title_key）が変更されています。曲名列は編集しないでください
  ```

  → 表示された **行番号のセルを Sheets で直して** Step 4→5 をやり直す。

---

## Step 6. インポートウィザードで取り込む

生成された `songs.csv` を既存の CSV インポートウィザード（songs）で取り込む。

- title 一致で全曲更新される（difficulty を含む全編集項目）。
- 列定義・トークンはインポート API と同一（`SONGS_CSV_HEADERS`）なのでそのまま通る。

---

## 運用メモ

- **difficulty 未設定（null）を早めに埋める**。難易度が null の曲は初心者対応（unit-02）で
  安全側に倒せず候補から外れやすい。参考列（演奏難易度・攻め方の目安）を見て順次埋める。
- **参考3列はインポート対象外**。あくまで人が difficulty / 超定番 等を判断するための材料。
- **title は照合キー**。既存曲の改名は本ツールでは行わない（改変検出でブロックされる）。
  改名が必要な場合はアプリ側の曲編集で行う。
- 生成の主経路は `list`（ローカル DB 不在時のブートストラップ）。運用が回り始めたら
  `--source db` で現在値ベースの往復に切り替える（同一出力になるよう共通化済み）。

---

## トラブルシュート

| 症状 | 原因 / 対処 |
| --- | --- |
| Sheets でドロップダウンが出ない | .xlsx をアップし「Google スプレッドシートで開く」で開き直す。CSV 変換自体はラベル文字列が正しければドロップダウン無しでも通る。 |
| `[行N] 未知のジャンル列です` | ジャンル列見出しを書き換えた／列を挿入した。見出しは9正式名（バラード等）のまま維持する。 |
| `[行N] 曲名（照合キー）が変更されています` | 曲名列を編集した。元の曲名に戻す（`__title_key` 隠し列が正）。 |
| `シート「master」が見つかりません` | シート名を変更した。`master` のまま維持する。 |
| 参考列が全部空 | 黒本1に無い曲、または綴り差。`kurobon1-difficulty.json` と曲名の正規化一致を確認。 |
| `--source db` で0曲 | `DATABASE_PATH` が誤り／DB 未マイグレート。パスとシードを確認する。 |
