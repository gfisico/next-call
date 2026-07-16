/**
 * ダークモードの「単一の真実源」ロジック（docs/dark_mode.md 準拠）。
 *
 * このファイルは "use client" を付けない（＝ server component からも import 可能）。
 * FOUC 防止のインラインスクリプト（THEME_INIT_SCRIPT）と、実行時フック
 * （use-dark-mode.ts）が、同一のストレージキー・同一の判定条件を共有する。
 * 判定条件が両者でズレると初回描画でチラつき（FOUC）が発生するため、
 * キーは THEME_STORAGE_KEY 単一定義をテンプレートリテラルで埋め込み、
 * 条件式は本ファイル内に隣接配置して一致を担保する（docs/dark_mode.md §3-4 の
 * 「重複ロジックだが意図的に先行実行する」に対応）。
 */

/** localStorage の唯一のキー（初期化・トグル・FOUC スクリプトで共有）。 */
export const THEME_STORAGE_KEY = "next-call-dark-mode";

/**
 * <head> 先頭に生インラインで注入する FOUC 防止スクリプト（同期実行）。
 * 判定条件は getInitialDark() と完全一致（保存値 'true' 優先 → 無ければ OS 設定）。
 * localStorage / matchMedia は try/catch で保護し、失敗時も描画を止めない。
 */
export const THEME_INIT_SCRIPT = `(function(){try{var d=localStorage.getItem('${THEME_STORAGE_KEY}');if(d==='true'||(d===null&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`;

/**
 * 初期テーマの決定。保存値（'true'/'false'）が最優先、無ければ OS 設定に
 * フォールバック（docs/dark_mode.md §3-1）。一度切り替えたら永続化して勝つ。
 * SSR / storage 無効環境では false（ライト）を安全側デフォルトとする。
 */
export function getInitialDark(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "true") return true;
    if (saved === "false") return false;
  } catch {
    // localStorage 無効時は握りつぶして OS 設定へフォールバック
  }
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/**
 * <html> への .dark 付け外しと localStorage への永続化を集約（docs §3-3）。
 * storage 例外は try/catch で握りつぶし、DOM 反映（機能）は止めない（docs §3-2）。
 */
export function applyDark(isDark: boolean): void {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", isDark);
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, String(isDark));
  } catch {
    // storage 無効・容量超過等は握りつぶす（機能停止させない）
  }
}
