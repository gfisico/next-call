/**
 * メモ一括移行 — コミット（unit-02 要件7）。**単一トランザクション**。
 *
 * 入力は unit-03 プレビュー画面で **補正済みの完全な確定ペイロード**。テキストは受け取らず
 * 再パースもしない（ユーザー補正が失われないことを構造的に保証）。途中の throw で全ロール
 * バックし部分取込を残さない。既存 CSV import（commit.ts）と同じ生成パターンを踏襲する:
 *   - normalizeTitle による曲名正規化 / stub（needs_review=true）作成
 *   - 楽器コードの一括実在検証（未知は 400）
 *   - date+venue 重複は conflict（二重取込防止）
 *   - performances は order 昇順で 1..N 採番、front_instruments を position 付き挿入
 * メモ移行で作るセッションは履歴のため status=ENDED（複数 ACTIVE を作らない）。
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import {
  instruments,
  performanceFrontInstruments,
  performances,
  sessionParticipants,
  sessions,
  songs,
  venues,
} from "@/db/schema";
import { normalizeTitle } from "@/lib/normalize-title";
import { conflict, validationError } from "@/server/http/errors";
import type { Tx } from "@/server/repositories/songs";
import type {
  MemoCommitInput,
  MemoCommitSession,
} from "@/server/validation/import-memo";

export interface MemoCommitSummary {
  sessionsCreated: number;
  performancesCreated: number;
  frontInstrumentsCreated: number;
  participantsCreated: number;
  venuesCreated: number;
  stubsCreated: number;
  sessionIds: number[];
}

/** 楽器コードが実在することを検証（未知は 400、details に unknownCodes） */
function assertInstrumentCodes(tx: Tx, codes: string[]): void {
  const unique = [...new Set(codes)].filter((c) => c !== "");
  if (unique.length === 0) return;
  const found = tx
    .select({ code: instruments.code })
    .from(instruments)
    .where(inArray(instruments.code, unique))
    .all();
  const known = new Set(found.map((r) => r.code));
  const unknown = unique.filter((c) => !known.has(c));
  if (unknown.length > 0) {
    throw validationError(`未知の楽器コードです: ${unknown.join(", ")}`, {
      unknownCodes: unknown,
    });
  }
}

/** venue を解決（existing→id / new→insert）。isHome は payload 値を尊重（既定 false） */
function resolveVenue(
  tx: Tx,
  venue: MemoCommitSession["venue"],
  summary: MemoCommitSummary,
): number {
  if (venue.kind === "existing") {
    const v = tx
      .select({ id: venues.id })
      .from(venues)
      .where(eq(venues.id, venue.id))
      .get();
    if (!v) throw validationError(`店舗が存在しません: venueId=${venue.id}`);
    return v.id;
  }
  // 同名既存があれば再利用（unique 衝突を避ける）
  const existing = tx
    .select({ id: venues.id })
    .from(venues)
    .where(eq(venues.name, venue.name))
    .get();
  if (existing) return existing.id;
  const created = tx
    .insert(venues)
    .values({ name: venue.name, isHome: venue.isHome })
    .returning({ id: venues.id })
    .get();
  summary.venuesCreated++;
  return created.id;
}

/**
 * 補正済みペイロードから Session/Performance/FrontInstrument/SessionParticipant を生成する。
 */
export function commitMemoImport(
  input: MemoCommitInput,
  db: Db = getDb(),
): MemoCommitSummary {
  return db.transaction((tx) => {
    const summary: MemoCommitSummary = {
      sessionsCreated: 0,
      performancesCreated: 0,
      frontInstrumentsCreated: 0,
      participantsCreated: 0,
      venuesCreated: 0,
      stubsCreated: 0,
      sessionIds: [],
    };

    for (const s of input.sessions) {
      const venueId = resolveVenue(tx, s.venue, summary);

      // 二重取込防止: 同一 date+venue のセッションが既にあれば conflict
      const dup = tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.sessionDate, s.sessionDate),
            eq(sessions.venueId, venueId),
          ),
        )
        .get();
      if (dup) {
        throw conflict(
          `同一 date+venue のセッションが既に存在します: ${s.sessionDate}`,
          { sessionDate: s.sessionDate, venueId, sessionId: dup.id },
        );
      }

      // 楽器コードの一括実在検証（participants + host + 全 front）
      const codes = [
        ...s.participants.map((p) => p.instrumentCode),
        ...(s.hostInstrumentCode ? [s.hostInstrumentCode] : []),
        ...s.performances.flatMap((p) => p.frontInstruments),
      ];
      assertInstrumentCodes(tx, codes);

      const listenerCount = s.listenerCount ?? null;
      const session = tx
        .insert(sessions)
        .values({
          sessionDate: s.sessionDate,
          venueId,
          status: "ENDED", // 履歴取込
          hasListeners: (listenerCount ?? 0) > 0,
          listenerCount,
          hostInstrumentCode: s.hostInstrumentCode ?? null,
        })
        .returning({ id: sessions.id })
        .get();
      summary.sessionsCreated++;
      summary.sessionIds.push(session.id);

      // 曲解決（同一 tx 内の new は normalized で再利用しキャッシュ）
      const songCache = new Map<string, number>();
      const resolveSong = (
        ref: MemoCommitSession["performances"][number]["songRef"],
      ): number => {
        if (ref.kind === "existing") {
          const exists = tx
            .select({ id: songs.id })
            .from(songs)
            .where(eq(songs.id, ref.id))
            .get();
          if (!exists) {
            throw validationError(`曲が存在しません: songId=${ref.id}`);
          }
          return ref.id;
        }
        const normalized = normalizeTitle(ref.title);
        const cached = songCache.get(normalized);
        if (cached !== undefined) return cached;
        const master = tx
          .select({ id: songs.id })
          .from(songs)
          .where(eq(songs.titleNormalized, normalized))
          .get();
        if (master) {
          songCache.set(normalized, master.id);
          return master.id;
        }
        const created = tx
          .insert(songs)
          .values({
            title: ref.title,
            titleNormalized: normalized,
            needsReview: ref.needsReview,
            hasPlayed: false,
          })
          .returning({ id: songs.id })
          .get();
        summary.stubsCreated++;
        songCache.set(normalized, created.id);
        return created.id;
      };

      // performances を order 昇順で 1..N 採番
      const ordered = [...s.performances].sort((a, b) => a.order - b.order);
      ordered.forEach((p, i) => {
        const songId = resolveSong(p.songRef);
        const perf = tx
          .insert(performances)
          .values({
            sessionId: session.id,
            songId,
            orderIndex: i + 1,
            participated: p.participated,
            instrument: p.participated ? p.instrument : "NONE",
            calledByMe: p.calledByMe,
            noChart: p.noChart,
            note: p.note ?? null,
          })
          .returning({ id: performances.id })
          .get();
        summary.performancesCreated++;

        if (p.frontInstruments.length > 0) {
          tx.insert(performanceFrontInstruments)
            .values(
              p.frontInstruments.map((code, position) => ({
                performanceId: perf.id,
                instrumentCode: code,
                position,
              })),
            )
            .run();
          summary.frontInstrumentsCreated += p.frontInstruments.length;
        }
      });

      // session_participants（重複コードは PK 衝突を明快な 400 に）
      const partCodes = s.participants.map((p) => p.instrumentCode);
      const dupCodes = partCodes.filter((c, i) => partCodes.indexOf(c) !== i);
      if (dupCodes.length > 0) {
        throw validationError(
          `参加者の楽器コードが重複しています: ${[...new Set(dupCodes)].join(", ")}`,
          { duplicateCodes: [...new Set(dupCodes)] },
        );
      }
      if (s.participants.length > 0) {
        tx.insert(sessionParticipants)
          .values(
            s.participants.map((p) => ({
              sessionId: session.id,
              instrumentCode: p.instrumentCode,
              count: p.count,
            })),
          )
          .run();
        summary.participantsCreated += s.participants.length;
      }
    }

    return summary;
  });
}
