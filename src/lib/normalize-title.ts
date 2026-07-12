/**
 * 曲名の照合用正規化（songs.title_normalized の唯一の生成規則）
 *
 * クイック登録（POST /api/songs/quick）の同名判定と、unit-08 の CSV インポートの
 * 曲名マッチの両方でこの関数を使う（契約: 正規化ロジックはここ以外に持たない）。
 *
 * 正規化内容:
 * - Unicode NFKC 正規化（全角英数・全角スペース等を半角へ）
 * - 小文字化
 * - 前後空白の除去
 * - 連続空白の 1 つへの圧縮
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
