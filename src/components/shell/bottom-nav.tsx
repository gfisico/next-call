"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** 下部固定ナビ（モバイルファースト app shell）。ナビ先は後続ユニットが実装する */
const NAV_ITEMS = [
  { href: "/", label: "セッション" },
  { href: "/suggest", label: "推薦" },
  { href: "/songs", label: "マスター" },
  { href: "/stats", label: "統計" },
  { href: "/settings", label: "設定" },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="メインナビゲーション"
      className="fixed inset-x-0 bottom-0 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-lg items-stretch">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // h-14 で h-10 以上のタップ領域を確保（design_rule §8.3）
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
