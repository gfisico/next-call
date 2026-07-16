"use client";

/**
 * メモ一括移行 "/sessions/import-memo"（unit-03 要件7）。
 * 貼付 → プレビュー → 補正 → 取込 の一連を MemoImport が担う。
 */
import Link from "next/link";
import { MemoImport } from "@/components/session/memo-import";

export default function ImportMemoPage() {
  return (
    <div className="space-y-4">
      <Link
        href="/sessions"
        className="inline-flex text-sm text-muted-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        ‹ セッション履歴に戻る
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">メモから一括取込</h1>
      <p className="text-sm text-muted-foreground">
        過去のセッションメモを貼り付けて、内容を確認・補正してから取り込みます。
      </p>
      <MemoImport />
    </div>
  );
}
