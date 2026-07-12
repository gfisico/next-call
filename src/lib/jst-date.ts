/**
 * JST (Asia/Tokyo) の「日付」ユーティリティ。
 * schema.ts の規約「session_date 等の日付は JST を正とする」に準拠する。
 */

const JST_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** JST での日付を YYYY-MM-DD で返す（sv-SE ロケールは ISO 形式を出力する） */
export function jstDateString(date: Date = new Date()): string {
  return JST_FORMATTER.format(date);
}
