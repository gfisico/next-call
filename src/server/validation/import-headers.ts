/**
 * CSV インポートの必須ヘッダ定義（純定数モジュール）
 *
 * `@/` エイリアスに依存しない素の TypeScript 定数のみを置く。これにより
 * アプリ本体（`@/` 解決あり）と CLI スクリプト（相対 import のみ解決可能な
 * tsx 実行）の双方から同一の列定義を共有できる。CSV 仕様の唯一の情報源は
 * discovery.md「Data Import Plan」。
 */

/** songs.csv の必須ヘッダ（順不同・過不足はプレビュー側で 400 判定） */
export const SONGS_CSV_HEADERS = [
  "title",
  "key",
  "form",
  "composer",
  "has_played",
  "no_chart_ok",
  "is_standard",
  "difficulty",
  "in_kurobon1",
  "season",
  "listener_level",
  "energy_level",
  "genres",
  "note",
] as const;

/** setlists.csv の必須ヘッダ（front_instruments は Excel 抽出が付与する追加列） */
export const SETLISTS_CSV_HEADERS = [
  "date",
  "venue_name",
  "order",
  "title",
  "participated",
  "instrument",
  "called_by_me",
  "no_chart",
  "memo",
  "front_instruments",
] as const;
