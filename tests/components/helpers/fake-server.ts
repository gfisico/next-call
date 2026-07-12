import type {
  Instrument,
  PerformanceWithFront,
  SessionDetail,
  SessionSummary,
  Song,
  Venue,
} from "@/lib/api/types";
import type { MockResult, RouteHandler } from "./mock-fetch";

const INSTRUMENT_CODES = [
  "vo",
  "ss",
  "as",
  "ts",
  "bs",
  "tp",
  "fl",
  "fh",
  "harm",
  "tb",
  "cl",
  "g",
];

function normalize(title: string): string {
  return title.trim().toLowerCase();
}

function makeSong(id: number, title: string, extra: Partial<Song> = {}): Song {
  return {
    id,
    title,
    titleNormalized: normalize(title),
    songKey: null,
    form: "OTHER",
    composer: null,
    hasPlayed: false,
    noChartOk: false,
    isStandard: false,
    simpleForm: false,
    inKurobon1: false,
    season: "ALL",
    listenerLevel: 3,
    energyLevel: 3,
    needsReview: false,
    note: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    genreTags: [],
    ...extra,
  };
}

/**
 * unit-03 API を模した最小のステートフル・フェイクサーバ。
 * criterion 1 の一連フロー（開始→追加→編集→削除→トグル→終了）を実挙動で駆動する。
 */
export class FakeServer {
  venues: Venue[] = [
    {
      id: 1,
      name: "Jazz Spot XYZ",
      isHome: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: 2,
      name: "Bar ABC",
      isHome: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  instruments: Instrument[] = INSTRUMENT_CODES.map((code, i) => ({
    code,
    label: code,
    sortOrder: i,
  }));
  songs: Song[] = [
    makeSong(1, "Stella By Starlight", { songKey: "B♭", form: "AABA" }),
    makeSong(2, "Alone Together", { songKey: "Dm", form: "ABAC" }),
  ];
  active: SessionDetail | null = null;
  ended: SessionDetail[] = [];
  private seq = { session: 100, perf: 500, song: 10 };

  private summaries(): SessionSummary[] {
    const all: SessionDetail[] = [
      ...this.ended,
      ...(this.active ? [this.active] : []),
    ];
    return all
      .map((s) => ({
        id: s.id,
        sessionDate: s.sessionDate,
        venueId: s.venueId,
        venueName: s.venueName,
        hasListeners: s.hasListeners,
        status: s.status,
        note: s.note,
        createdAt: s.createdAt,
      }))
      .sort((a, b) => b.id - a.id);
  }

  private renumber(perfs: PerformanceWithFront[]) {
    perfs.forEach((p, i) => {
      p.orderIndex = i + 1;
    });
  }

  private resolveSongByTitle(title: string): Song {
    const norm = normalize(title);
    const found = this.songs.find((s) => s.titleNormalized === norm);
    if (found) return found;
    const song = makeSong(++this.seq.song, title, { needsReview: true });
    this.songs.push(song);
    return song;
  }

  readonly route: RouteHandler = ({ method, path, search, body }) => {
    const b = (body ?? {}) as Record<string, unknown>;

    // --- masters ---
    if (path === "/api/venues" && method === "GET") {
      return this.ok({ venues: this.venues });
    }
    if (path === "/api/instruments" && method === "GET") {
      return this.ok({ instruments: this.instruments });
    }
    if (path === "/api/songs" && method === "GET") {
      const q = (search.get("q") ?? "").toLowerCase();
      const songs = q
        ? this.songs.filter((s) => s.title.toLowerCase().includes(q))
        : this.songs;
      return this.ok({ songs });
    }
    if (path === "/api/songs/quick" && method === "POST") {
      const title = String(b.title);
      const norm = normalize(title);
      const existing = this.songs.find((s) => s.titleNormalized === norm);
      if (existing) {
        return { status: 409, body: { error: { code: "CONFLICT", message: "同名", details: { song: existing } } } };
      }
      const song = makeSong(++this.seq.song, title, { needsReview: true });
      this.songs.push(song);
      return { status: 201, body: { song } };
    }

    // --- sessions ---
    if (path === "/api/sessions/active" && method === "GET") {
      return this.active
        ? this.ok({ session: this.active })
        : { status: 404, body: { error: { code: "NOT_FOUND", message: "なし" } } };
    }
    if (path === "/api/sessions" && method === "GET") {
      return this.ok({ sessions: this.summaries() });
    }
    if (path === "/api/sessions" && method === "POST") {
      if (this.active) {
        return {
          status: 409,
          body: {
            error: {
              code: "CONFLICT",
              message: "進行中あり",
              details: { activeSessionId: this.active.id },
            },
          },
        };
      }
      const venue = this.venues.find((v) => v.id === b.venueId);
      const session: SessionDetail = {
        id: ++this.seq.session,
        sessionDate: "2026-07-12",
        venueId: Number(b.venueId),
        venueName: venue?.name ?? "",
        hasListeners: Boolean(b.hasListeners),
        status: "ACTIVE",
        note: null,
        createdAt: "2026-07-12T10:00:00.000Z",
        performances: [],
      };
      this.active = session;
      return { status: 201, body: { session } };
    }

    const sessionMatch = path.match(/^\/api\/sessions\/(\d+)$/);
    if (sessionMatch) {
      const id = Number(sessionMatch[1]);
      const target =
        this.active?.id === id
          ? this.active
          : this.ended.find((s) => s.id === id) ?? null;
      if (!target) {
        return { status: 404, body: { error: { code: "NOT_FOUND", message: "なし" } } };
      }
      if (method === "GET") return this.ok({ session: target });
      if (method === "PATCH") {
        if (typeof b.hasListeners === "boolean") {
          target.hasListeners = b.hasListeners;
        }
        if (b.status === "ENDED") {
          target.status = "ENDED";
          if (this.active?.id === id) {
            this.ended.push(this.active);
            this.active = null;
          }
        }
        return this.ok({ session: target });
      }
    }

    const perfCreate = path.match(/^\/api\/sessions\/(\d+)\/performances$/);
    if (perfCreate && method === "POST") {
      const sid = Number(perfCreate[1]);
      const session = this.active?.id === sid ? this.active : null;
      if (!session) {
        return { status: 409, body: { error: { code: "CONFLICT", message: "終了済み" } } };
      }
      const song =
        b.quickTitle !== undefined
          ? this.resolveSongByTitle(String(b.quickTitle))
          : this.songs.find((s) => s.id === b.songId)!;
      const fronts = ((b.frontInstruments ?? []) as { code: string; position: number }[])
        .slice()
        .sort((x, y) => x.position - y.position)
        .map((f, i) => ({ code: f.code, position: i }));
      const perf: PerformanceWithFront = {
        id: ++this.seq.perf,
        sessionId: sid,
        songId: song.id,
        orderIndex: session.performances.length + 1,
        participated: Boolean(b.participated),
        instrument: (b.instrument as PerformanceWithFront["instrument"]) ?? "NONE",
        calledByMe: Boolean(b.calledByMe),
        noChart: Boolean(b.noChart),
        note: (b.note as string | null) ?? null,
        createdAt: "2026-07-12T10:05:00.000Z",
        songTitle: song.title,
        frontInstruments: fronts,
      };
      session.performances.push(perf);
      return { status: 201, body: { performance: perf } };
    }

    const perfMatch = path.match(/^\/api\/performances\/(\d+)$/);
    if (perfMatch) {
      const pid = Number(perfMatch[1]);
      const session = this.active;
      const perf = session?.performances.find((p) => p.id === pid);
      if (method === "DELETE") {
        if (session && perf) {
          session.performances = session.performances.filter((p) => p.id !== pid);
          this.renumber(session.performances);
        }
        return { status: 204 };
      }
      if (method === "PATCH" && perf) {
        if (typeof b.participated === "boolean") perf.participated = b.participated;
        if (b.instrument) perf.instrument = b.instrument as PerformanceWithFront["instrument"];
        if (typeof b.calledByMe === "boolean") perf.calledByMe = b.calledByMe;
        if (typeof b.noChart === "boolean") perf.noChart = b.noChart;
        if (b.note !== undefined) perf.note = (b.note as string | null) ?? null;
        if (b.frontInstruments !== undefined) {
          perf.frontInstruments = (
            b.frontInstruments as { code: string; position: number }[]
          )
            .slice()
            .sort((x, y) => x.position - y.position)
            .map((f, i) => ({ code: f.code, position: i }));
        }
        return this.ok({ performance: perf });
      }
    }

    return { status: 404, body: { error: { code: "NOT_FOUND", message: `unhandled ${method} ${path}` } } };
  };

  private ok(body: unknown): MockResult {
    return { status: 200, body };
  }
}
