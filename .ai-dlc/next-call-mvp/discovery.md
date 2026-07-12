---
intent: next-call-mvp
created: 2026-07-12
status: active
---

# Discovery Log: ジャズセッション向け選曲提案アプリ (next-call) MVP

Elaboration findings persisted during Phase 2.5 domain discovery.
Builders: read section headers for an overview, then dive into specific sections as needed.

一次仕様書: `docs/jazz_session_song_recommendation_spec_v2.md`（全852行を精読済み。以下「仕様§n」で参照）
デザインルール: `docs/design_rule.md`（Tailwind + shadcn/ui。全画面でこれに準拠）

## Domain Model

### Entities

#### Song（曲マスター）— 仕様§7
推薦の中心となるマスター。1曲に複数のジャンル・特徴を付与できる（多対多）。

| 属性 | 型（案） | 出典 | 備考 |
|---|---|---|---|
| id | integer PK | - | |
| title | text UNIQUE | §7.1 曲名 | 正規化した照合用 title_normalized も持つ（インポート時の曲名マッチ用） |
| song_key | text | §7.1 黒本キー | 例: C, F, Bb, Eb, G, Fm… 黒本記載キー |
| form | enum: AABA / ABAC / BLUES12 / OTHER | §7.1 構成 | 「直前と同構成は完全除外」に使用 |
| composer | text | §7.1 作曲者 | |
| has_played | boolean | §7.1 演奏経験あり | アプリ内での「コール可能」判定の唯一の材料（後述 Key Finding） |
| no_chart_ok | boolean | §6.1/§7.1 譜面なし対応可 | 演奏実績がある曲に付くフラグ。初心者対応AND条件・安全性判定に使用 |
| is_standard | boolean | §7.1 超定番 | 初心者対応AND条件・安全性判定に使用 |
| simple_form | boolean | §7.1 構成が単純 | 同上 |
| in_kurobon1 | boolean | §7.1 黒本1掲載 | 譜面共有環境の制約（§11）。安全性ではない |
| season | enum: SPRING / SUMMER / AUTUMN / WINTER / ALL | §7.1 季節 | PiaScore季節セットリスト由来（§9.7） |
| listener_level | integer 1–5 | §7.1 リスナー向け度 | 付与方法は§21未確定 → Provisional Values 参照（手動付与・デフォルト3） |
| energy_level | integer 1–5 | §7.1 盛り上がり度 | 同上 |
| note | text | §7.1 その他 | 任意メモ |

#### GenreTag（ジャンル・特徴）— 仕様§7.2
固定9種: `バラード / ボサノバ / 3拍子 / モード / ファンク / ブルース / 歌もの / 循環 / キメが多い曲`。
実装はマスターテーブル（将来の追加に備える）+ 中間テーブル `song_genres(song_id, genre_id)`。
「特殊ジャンル連続回避」（§12.3）の対象は上記のうち `キメが多い曲` を含む8種（循環は対象外である点に注意 — §12.3の列挙は バラード/ボサノバ/モード/3拍子/ファンク/キメが多い曲/ブルース/歌もの）。

#### Venue（店舗マスター）— 仕様§4.2
| 属性 | 型（案) | 備考 |
|---|---|---|
| id | integer PK | |
| name | text UNIQUE | 店舗・イベント名 |
| is_home | boolean | 某店=true / 某店以外=false。**初回登録時に一度だけ判定して保存**。以後は自動参照（毎回選ばせない） |
| created_at | datetime | |

店舗区分は「セットリスト登場頻度」（§13）の参照先切替にのみ使う内部区分。

#### Session（セッション）— 仕様§4
| 属性 | 型（案） | 備考 |
|---|---|---|
| id | integer PK | |
| session_date | date | |
| venue_id | FK → Venue | |
| has_listeners | boolean | セッション中いつでも変更可（§4.3）。ヴォーカル客フラグは設けない |
| status | enum: ACTIVE / ENDED | 記録主画面 ⇔ 履歴の切替 |
| note | text | iPhoneメモで管理していたその他情報の受け皿 |

#### Performance（演奏記録 / セットリスト行）— 仕様§5
自分が参加していない曲も含めて全曲登録する（§5）。

| 属性 | 型（案） | 備考 |
|---|---|---|
| id | integer PK | |
| session_id | FK → Session | |
| song_id | FK → Song | |
| order_index | integer | 演奏順。**「直前の曲」= ACTIVEセッション内 order_index 最大の行** |
| participated | boolean | 自分の参加有無 |
| instrument | enum: SAX / PIANO / NONE | §5.1。候補抽出は常にサックス前提、ピアノは履歴のみ（§5.2） |
| called_by_me | boolean | 累計コール回数集計（§12.7）・コール傾向（§10.4）に使用 |
| no_chart | boolean | 「譜面なしだったか」（事実の記録）。曲マスターの no_chart_ok（能力フラグ）とは別物 |
| note | text | |

#### SelectionIntent（選曲意図）— 仕様§9
参加曲の都度変更、**前回値を引き継ぐ**（§9冒頭）。推薦リクエストのスナップショットとして保存しつつ、「最後に使った値」を carry-over 用に保持する。

| 属性 | 型（案） | UI | 備考 |
|---|---|---|---|
| rare | integer −2..+2 | 5段階スライダー | 珍しい曲（§9.2）店舗区分別登場回数を参照 |
| long_unplayed | integer −2..+2 | 5段階スライダー | 久しぶりの曲（§9.3）基準: 最終演奏から1年以上 |
| safety | integer −2..+2 | スライダー（左=安全に行く / 右=攻める） | §9.4 |
| mood | integer −2..+2 | スライダー（左=落ち着かせる / 右=盛り上げる） | §9.5。盛り上げ=ファンク自動優先ではない |
| ballad | integer −2..+2 | スライダー（左=避けたい / 右=やりたい） | §9.6 独立スライダー |
| seasonal | boolean | チェックボックス | §9.7。1曲目はデフォルトON（変更可）。対象季節は日付から自動判定 |
| listener_focus | boolean | チェックボックス | §9.8 |

#### RecommendationRequest / RecommendationCandidate（推薦履歴）— 仕様§14.3
繰り返し減点（同じ曲・同じジャンルの連続提示防止）のために全リクエストと提示候補を永続化する。

- RecommendationRequest: `id, session_id, requested_at, horns(ONE/MULTI/UNKNOWN), beginner(NONE/PRESENT/UNKNOWN), kurobon1_only(bool), genre_override(json)`, intent各値のスナップショット, `condition_signature(text)`（「同じような条件」判定用ハッシュ）, `pool_size(integer)`（緩和判定の記録）
- RecommendationCandidate: `request_id, song_id, candidate_type(NORMAL/ONE_HORN/MULTI_HORN/BEGINNER), score, reasons(json), display_order`

#### PendingSong（保留曲）— 仕様§16
曲だけを保存。理由・期限・スコアは持たない。セッションをまたいで保持。

| 属性 | 型（案） | 備考 |
|---|---|---|
| song_id | FK → Song（UNIQUE） | |
| created_at | datetime | 保留登録日時 |

解除 = 行削除（または is_active=false で履歴保持。MVPは行削除で十分）。コール時自動解除は未確定（§21）→ Provisional Values 参照。

#### Setting（設定）
key-value ストア。§21の全暫定値（スコア重み・減点強度・集計期間・季節の区切り月・候補集団の作り方・乱数温度・候補数など）をここに置き、設定画面から調整可能にする（Clarification回答どおり）。`key text PK, value json, updated_at`。

#### User（認証）
単一ユーザー・Googleログイン。**DBにユーザーテーブルは作らない**方針（Auth.js JWT戦略 + メールアドレス許可リスト環境変数）。サインアップ画面なし。

### Relationships

- Venue 1 — N Session
- Session 1 — N Performance（order_index で順序付け）
- Song 1 — N Performance
- Song N — M GenreTag（song_genres）
- Session 1 — N RecommendationRequest 1 — N RecommendationCandidate（N — 1 Song）
- Song 1 — 0..1 PendingSong

### Lifecycle

1. **セッション**: 開始（日付・店舗入力。未登録店舗なら某店/某店以外を初回のみ判定）→ ACTIVE（曲を順次登録、リスナー客トグルはいつでも変更）→ 「次の曲を考える」で選曲支援モードへ何度でも往復 → 終了（ENDED）→ 以後は演奏履歴として集計対象。
2. **推薦**: 編成条件+意図（前回値引き継ぎ）入力 → パイプライン実行 → 候補提示（+保留曲を無条件で別枠表示）→ コール登録（Performance生成、called_by_me=true）or 保留登録 or 再抽選。
3. **保留曲**: 登録 → セッションまたぎで保持 → 手動解除（コール時の自動解除は暫定OFF+確認ダイアログ）。

### Data Sources

- **SQLite（クラウドDB・VPS上、アプリ唯一の永続層）**:
  - Available: 上記全エンティティ。集計はすべてSQLで賄える規模（曲マスター数百曲、セッション数百件、演奏記録は5年×週次でも数千〜1万行程度）。30秒以内の候補提示（§20）は余裕。
  - Missing: 初期データ（下記）。
- **iPhoneメモ（セットリスト履歴 約5年分 + 曲マスター元データ）**:
  - Available: 利用者が手動管理してきたテキスト。
  - Missing: **実データのフォーマットは未入手**（Open Questions）。CSV化はユーザー作業 or 変換支援が必要。
- **PiaScore（季節曲: 春夏秋冬のセットリスト）**:
  - Available: 曲名の一覧（アプリ内で目視可能）。
  - Missing: エクスポートAPIなし。手動転記→曲マスターCSVの season 列に反映する想定（§21未確定 → Provisional）。

### Data Gaps

1. **ヴォーカル参加フラグが存在しない**: §12.5「ヴォーカル参加曲の後は歌ものを避ける」の判定材料が演奏記録にない。→ 暫定: 直前曲の「歌もの」属性で代替（§12.3の連続回避と同一化）。演奏記録への「ヴォーカル参加」フラグ追加は Open Question。
2. **仕込み済み曲はアプリ管理外**（§6/§19）: よってアプリ内の「コール可能曲」= `has_played=true` のみ。仕込み曲を候補に出したい場合はユーザーが has_played を手動でONにする運用（マスター編集画面で可能にする）。
3. **has_played と演奏履歴の二重管理**: has_played はマスターの明示フラグとして持ち、履歴から自動導出しない（インポート前の曲や記録漏れに対応）。ただしインポート時に「participated=true の履歴がある曲は has_played を ON にする」再計算オプションを提供。
4. **listener_level / energy_level の初期値**: 全曲手動付与は負担。→ デフォルト3で開始し、マスター一覧のインライン編集+CSV列で段階的に整備（Provisional）。
5. **某店の判定ルール**: 某店の実店舗名・表記揺れが未入手。→ 設定 `home_venue_names`（正規化名リスト）と照合、未登録店舗は初回登録UIで利用者が1回だけ確定（Open Question）。

## Recommendation Logic Analysis

仕様§8/§10/§11/§12/§13/§14 を、実装可能な**9ステージの純関数パイプライン**に整理した。エンジンは `(曲リスト+集計値, 編成条件, 意図, 設定) → 候補+理由` の副作用なし関数とし、単体テストを厚くする。

### 入力（エンジンに渡す事前集計）

- 全曲 + ジャンル集合
- 当日セッションの演奏済み song_id 集合、直前曲（key / form / composer / genres / in_kurobon1 / season / listener_level / energy_level）
- 曲ごと: 店舗区分別登場回数（設定期間内）、自分の最終演奏日、自分の演奏回数、自分の累計コール回数
- 全体: 自分のコール回数上位10曲、ジャンル別自分のコール比率（低頻度ジャンル判定）
- 推薦履歴: 直近リクエストの提示曲、直近N回の提示曲、同一 condition_signature での提示回数、直近リクエストの提示ジャンル
- 現在の季節（セッション日付+設定の区切り月から判定）

### Stage 1: 完全除外（§12.1）

| 条件 | 出典 |
|---|---|
| has_played=false（コール可能曲でない） | §6/§12.1 |
| 当日すでに演奏済み | §12.1 |
| 直前の曲と form が同じ | §12.1 |
| 初心者対応時（beginner=PRESENT）: NOT(is_standard AND no_chart_ok AND simple_form) | §8.2/§12.1 |
| kurobon1_only=true かつ in_kurobon1=false | §11/§12.1 |

### Stage 2: 編成条件（§8）

- horns=MULTI: 歌もの → **強い減点**（完全除外ではなく減点。§8.3「今後調整」→ Provisional: −15、除外/減点は設定で切替可）
- horns=UNKNOWN / beginner=UNKNOWN: 通常候補に加え、条件別ブランチ（Stage 9）を実行

### Stage 3: 強制条件

- kurobon1_only は Stage 1 で除外済み
- genre_override（§10）: 指定時は該当ジャンルへの**フィルタ**（Provisional。加点方式ではない）。指定時は低頻度ジャンル減点を無効化

### Stage 4: スコアリング

`score = BASE(50) + Σ(意図スライダー寄与) + Σ(チェックボックス寄与) − Σ(ルール減点)`

**意図スライダー寄与**（s = スライダー値 −2..+2）:

| 項目 | 寄与式 | metric |
|---|---|---|
| 珍しい曲 | s × 6 × m_rare | 店舗区分別登場回数 a（期間内）: a=0→1.0, 1–2→0.8, 3–5→0.5, 6–10→0.2, 11+→0.0 |
| 久しぶり | s × 6 × m_old | m_old = min(自分の最終演奏からの日数 / 730, 1.0)。未演奏（has_played=trueだが履歴なし）→1.0 |
| 安全性 | (−s) × 1.2 × (safety_score − 5) | safety_score(0–10) = 2×is_standard + 3×no_chart_ok + 2×simple_form + min(自分の演奏回数,5)×0.4 + min(自分のコール回数,3)×⅓。左(−2)=安全曲に最大+12 / 右(+2)=未知曲に最大+12 |
| 雰囲気 | s × 6 × (energy_level − 3) / 2 | ファンク自動優先はしない（属性でなく energy_level のみ参照。§9.5） |
| バラード | バラード属性を持つ曲に s × 8 | s≥+1 のときバラードの低頻度ジャンル減点を免除 |

**チェックボックス寄与**:

| 項目 | 寄与 |
|---|---|
| 季節感 ON | 曲の season == 現在の季節 → +10（通年・不一致は0。避ける方向なし。§9.7） |
| リスナー向け ON | (listener_level − 3) × 4（−8..+8。§9.8） |

**ルール減点**（すべて設定値。既定値は Provisional Values 参照）:

| ルール | 既定 | 出典 |
|---|---|---|
| 直前曲と同じ黒本キー | −15（F・B♭のみ −8 に緩和） | §12.2 |
| 直前曲と特殊ジャンル・特徴が重複（8種、1種ごと） | −15（ジャンル別に 減点/除外 切替可） | §12.3 |
| ブルース常時減点 | −10 | §12.4 |
| 直前曲と同じ作曲者 | −5（やや減点。除外しない） | §12.6 |
| 累計コール回数 上位10曲 | −12（beginner=PRESENT または safety≤−1 で半減 −6） | §12.7 |
| 低頻度ジャンル（自分のコール比率 < 5% のジャンル） | −8（当該曲の意図由来プラス寄与合計 ≥ +10 なら免除 = 「条件に十分合う場合だけ候補へ戻す」§10.4） | §10.3–10.4 |
| horns=MULTI の歌もの | −15 | §8.3/§12.5 |

### Stage 5: 繰り返し減点（§14.3–14.4）

| 条件 | 既定 |
|---|---|
| 前回リクエストで提示した曲 | −12 |
| 直近5リクエスト（30日以内、セッション横断）で提示した曲 | −6 |
| 同一 condition_signature で30日以内に3回以上提示した曲 | 追加 −6 |
| 前回リクエストの候補に含まれた特殊ジャンルを持つ曲 | −3（ジャンル繰り返し抑制 §14.4） |

**緩和**: Stage 1–3 通過曲数 < 8 のとき、上記をすべて半減（「強い条件指定で候補が少ない場合は減点を緩和」§14.3、「多様性より条件適合を優先」§22-11）。

### Stage 6: 候補集団の作成（§14.2）

- `score ≥ maxScore − 10`（点差バンド）かつ `score ≥ 30`（最低スコア床）
- 集団サイズ < candidate_count+2 の場合、バンドを −15 まで一度だけ拡大
- それでも候補が candidate_count 未満なら**無理に増やさず、少ないことをUIに明示**（§14.5）

### Stage 7: 重み付きランダム抽出（§14.2/§14.4）

- weight = exp((score − maxScore) / τ)、τ=5（softmax。高得点ほど選ばれやすい非均等抽選）
- candidate_count（既定3）曲を非復元抽出。1曲引くたびに、同じ特殊ジャンルを持つ残余曲の weight を ×0.5（ジャンル偏り抑制）

### Stage 8: 推薦理由生成（固定テンプレート。LLM不使用）

発火したルール・事実からテンプレート文を最大4件/曲。例（§15.1準拠）:

| トリガー | テンプレート |
|---|---|
| m_old ≥ 1.0 / ≥0.5 | 「最終演奏から{n}年{m}ヶ月ぶり」 |
| m_rare ≥ 0.8 | 「この店（区分）では直近{期間}の登場{a}回と少なめ」 |
| キー・構成・特殊ジャンルすべて直前曲と不一致 | 「直前曲とキー・構成・雰囲気が変わる」 |
| mood寄与 > 0 | 「今回の『{やや/強く}{盛り上げる/落ち着かせる}』に合う」 |
| listener ON かつ level≥4 | 「リスナーが楽しみやすい曲」 |
| seasonal ON かつ一致 | 「いまの季節（{季節}）の曲」 |
| beginner=PRESENT | 「超定番・譜面なし対応可・構成が単純で初心者向き」 |
| safety寄与 > 0（左） | 「演奏経験・譜面なし対応ありで手堅い」 |
| safety寄与 > 0（右） | 「最近やっていない攻めの一手」 |
| バラード s≥+1 かつ該当 | 「バラードをやりたい意向に合致」 |

### Stage 9: 条件別候補（§8/§15.2）

horns=UNKNOWN → horns=ONE と horns=MULTI の2ブランチ、beginner=UNKNOWN → beginner=NONE と PRESENT の2ブランチでパイプラインを再実行（Stage 5 の履歴減点は共有）。各ブランチの最上位曲が通常候補と重複しない場合のみ「1管なら」「複数管なら」「初心者が参加するなら」ラベル付きで追加提示。重複する場合は追加しない（§8.1/§15.2）。

### 保留曲の扱い（§16）

推薦スコアに一切影響しない。推薦結果の下に**無条件で別枠表示**。完全除外に該当していても隠さず、警告バッジを付ける: 「当日演奏済み」「直前曲と同じ構成」「黒本1条件外」「今回の編成に合いにくい（複数管×歌もの等）」。通常候補と重複した場合は候補側に「保留中」バッジ。

## Provisional Values

§21の未確定事項に対する実装用暫定値。**すべて Setting テーブルに置き、設定画面から変更可能**（Clarification回答どおり）。

| # | §21項目 | 暫定値 | 設定キー（案） |
|---|---|---|---|
| 1 | セットリスト登場回数の集計期間 | 直近2年（730日）。全期間集計は将来の比較検証用に画面表示のみ | `engine.appearance_window_days = 730` |
| 2 | キー別の除外・減点強度 | 完全除外にせず減点。既定 −15、F と B♭ は −8 | `engine.same_key_penalty = 15` / `engine.same_key_penalty_overrides = {"F":8,"Bb":8}` |
| 3 | 特殊ジャンル連続時の扱い | 全8種とも「強い減点 −15」（除外にしない）。ジャンル別に penalty/exclude を切替可 | `engine.consecutive_genre = {"default":{"mode":"penalty","value":15}}` |
| 4 | 管楽器複数時の歌もの | 強い減点 −15（完全除外にしない） | `engine.multi_horn_vocal_penalty = 15` |
| 5 | 安全性スコアの計算式 | safety_score(0–10) = 2×超定番 + 3×譜面なし対応可 + 2×構成単純 + min(演奏回数,5)×0.4 + min(コール回数,3)×⅓、寄与 = (−s)×1.2×(safety_score−5) | `engine.safety_weights = {...}` |
| 6 | 盛り上がり度・リスナー向け度の付与方法 | 1–5の整数を手動付与。未設定はデフォルト3。CSVインポート列+マスター一覧インライン編集で整備 | `master.default_level = 3` |
| 7 | ジャンル上書きのUI | 選曲支援画面の折りたたみ「詳細条件」内にジャンルチップ（複数選択、OR条件の**フィルタ**）。既定は未選択=指定なし | - |
| 8 | 候補集団の作り方 | 最高点から10点以内 かつ スコア30以上。不足時はバンドを15点へ一度だけ拡大 | `engine.pool_band = 10` / `engine.pool_band_relaxed = 15` / `engine.score_floor = 30` |
| 9 | ランダム抽出の重み | softmax: exp((score−max)/τ)、τ=5 | `engine.random_temperature = 5` |
| 10 | 推薦履歴による減点期間 | 前回提示 −12 / 直近5回(30日) −6 / 同条件3回以上 追加−6。候補<8で半減 | `engine.repeat_penalties = {...}` / `engine.repeat_window_days = 30` / `engine.relax_pool_threshold = 8` |
| 11 | 通常候補の表示数 | 3曲（設定で1–5） | `engine.candidate_count = 3` |
| 12 | 保留曲コール時の自動解除 | 自動解除しない。コール登録時に「保留を解除しますか？」確認ダイアログ | `pending.auto_release_on_call = false` |
| 13 | 季節曲のPiaScore移行 | エクスポート手段がないため、春夏秋冬セットリストの曲名を手動転記し、曲マスターCSVの season 列で投入 | - |
| 14 | 低頻度ジャンルを候補に戻す条件 | 低頻度判定: 自分のコール比率<5%。当該曲の意図由来プラス寄与合計 ≥ +10、またはジャンル上書き指定時に減点免除 | `engine.low_freq_threshold = 0.05` / `engine.low_freq_penalty = 8` / `engine.low_freq_waiver_bonus = 10` |

**追加の暫定値（§21外だが実装に必要）**:

| 項目 | 暫定値 | 設定キー（案） |
|---|---|---|
| 基礎点 | 50 | `engine.base_score = 50` |
| スライダー重み | 珍しさ/久しぶり/雰囲気: 6、バラード: 8、安全性: 1.2（式内係数） | `engine.slider_weights = {...}` |
| 季節一致加点 | +10 | `engine.seasonal_bonus = 10` |
| リスナー向け重み | (level−3)×4 | `engine.listener_weight = 4` |
| 季節の区切り月 | 春=3–5月, 夏=6–8月, 秋=9–11月, 冬=12–2月 | `engine.season_months = {...}` |
| 「久しぶり」基準 | 365日（理由文の閾値。metric は730日で飽和） | `engine.long_unplayed_days = 365` |
| ブルース常時減点 | −10 | `engine.blues_penalty = 10` |
| 同一作曲者減点 | −5 | `engine.same_composer_penalty = 5` |
| コール上位N曲減点 | N=10, −12（初心者対応/安全時 −6） | `engine.top_called_n = 10` / `engine.top_called_penalty = 12` |
| 1曲目の季節チェック初期値 | ON（§9.7の案を採用） | `engine.first_song_seasonal_default = true` |

## Tech Stack & Architecture

### 構成一覧

| レイヤ | 採用技術 | 理由 |
|---|---|---|
| フレームワーク | Next.js（App Router）+ TypeScript strict | Clarification確定。モバイルWeb→将来PWA化可能 |
| UI | Tailwind CSS + shadcn/ui | `docs/design_rule.md` 準拠（カラートークン、h-10タップ領域、focus-visible等） |
| DB | SQLite（WALモード）+ **Drizzle ORM** + better-sqlite3 | 下記比較 |
| 認証 | Auth.js (next-auth v5) Google provider、**JWT セッション戦略 + メール許可リスト** | DBアダプタ不要・ユーザーテーブル不要。`ALLOWED_EMAILS` 環境変数と signIn コールバックで照合。middleware で全ルート保護。サインアップ画面なし |
| バリデーション | Zod | CSVインポート・フォーム・設定値の検証を共通化 |
| ミューテーション | Server Actions | 単一ユーザー・小規模のためAPIレイヤを薄く |
| テスト | Vitest（+ Testing Library） | 推薦エンジン純関数の単体テストが中心 |
| Lint/Format | ESLint + Prettier | |

### Technology Choice: ORM（Drizzle vs Prisma）

| 観点 | Drizzle | Prisma |
|---|---|---|
| SQLite適合 | better-sqlite3 同期ドライバを直接利用。軽量・高速 | 動作するが Rust クエリエンジン同梱でイメージが重い（driver adapter は改善中） |
| Docker/Alpine | ネイティブモジュール（better-sqlite3）のビルドのみ | エンジンバイナリのプラットフォーム整合に注意が必要 |
| スキーマ定義 | TypeScriptコードそのもの（codegen不要） | 独自DSL + generate ステップ |
| 生SQL/集計 | `sql` タグで自在（推薦用の集計クエリと相性良） | 可能だが型付けが弱い |
| マイグレーション | drizzle-kit generate/migrate | prisma migrate（成熟） |
| 管理GUI | drizzle-kit studio | Prisma Studio（強み） |

**推奨: Drizzle ORM**。単一ユーザー・SQLite・Docker自前ホスティングという本件条件では、ランタイムが薄く生SQL集計と親和的な Drizzle が明確に有利。マイグレーションは drizzle-kit で生成した SQL をコンテナ起動時に適用する。

### ディレクトリ構成（案）

```text
src/
  app/
    (auth)/login/page.tsx        # Googleログインのみ
    page.tsx                     # ホーム: ACTIVEセッション or 開始/履歴一覧
    sessions/[id]/page.tsx       # セッション記録画面（主画面）
    sessions/[id]/suggest/page.tsx  # 選曲支援画面（編成・意図・結果）
    songs/page.tsx               # 曲マスター一覧（インライン編集）
    songs/[id]/page.tsx          # 曲マスター編集
    venues/page.tsx              # 店舗マスター（某店区分の確認・修正）
    pending/page.tsx             # 保留曲一覧・解除
    import/page.tsx              # CSVインポート（曲マスター/セットリスト履歴）
    settings/page.tsx            # 設定画面（Provisional Values の全キー）
    api/health/route.ts          # デプロイ用ヘルスチェック
  components/ui/                 # shadcn/ui 生成物
  components/session/ components/suggest/ components/songs/ ...
  db/
    schema.ts                    # Drizzle スキーマ（単一ファイルで開始）
    client.ts                    # better-sqlite3 + WAL 設定
    migrations/                  # drizzle-kit 生成SQL
  lib/
    engine/                      # ★推薦エンジン（純関数・フレームワーク非依存）
      types.ts exclusions.ts scoring.ts repeat.ts pool.ts draw.ts reasons.ts index.ts
    aggregate.ts                 # 事前集計クエリ（登場回数・最終演奏日・コール回数等）
    settings.ts                  # Setting の読み書き + Zodスキーマ + 既定値
    season.ts                    # 季節判定
    auth.ts                      # Auth.js 設定（許可リスト）
  server/
    actions/                     # Server Actions（薄く。engine/queries を呼ぶだけ）
    queries/                     # 読み取り系データアクセス
```

### データアクセス層の設計方針

- **推薦エンジンはDB非依存の純関数**: `recommend(input: EngineInput, settings: EngineSettings): RecommendationResult`。`aggregate.ts` がSQLで EngineInput を組み立てる。乱数は seed 注入可能にしてテスト決定性を確保。
- 書き込みは Server Actions 経由のみ。Zodで入力検証。SQLiteは単一書き込みのため排他は実質不要（WAL + busy_timeout 設定のみ）。
- 集計（店舗区分別登場回数・キー/構成/ジャンル別の当日集計など）はSQL側で実施し、アプリ側で二重集計しない。

## Deployment Architecture

Clarification確定事項: VPS自前ホスティング、GitHub Actions + Docker、mainへのpushで自動デプロイ。

### コンテナ構成（VPS上、docker compose）

```text
[Internet] → Caddy（:443, TLS自動取得/更新, リバースプロキシ） → next-call app（:3000, Next.js standalone）
                                                                    └ volume: /data（SQLite: /data/next-call.db + WAL）
```

- **app イメージ**: multi-stage Dockerfile。`node:22-bookworm-slim` ベース（better-sqlite3 のネイティブビルドのため build stage に python3/make/g++、実行 stage は slim + `next build` の standalone 出力のみ）。
- **起動シーケンス**: entrypoint で `drizzle migrate（生成済みSQL適用）` → `node server.js`。
- **SQLite永続化**: named volume または `/srv/next-call/data` の bind mount。`DATABASE_PATH=/data/next-call.db`。
- **リバースプロキシ/TLS**: Caddy を推奨（Caddyfile 数行で Let's Encrypt 自動化）。VPSに既存の Nginx がある場合はそれに従う（Open Question）。
- **バックアップ**: VPS の cron で毎日 `sqlite3 /data/next-call.db ".backup /backup/next-call-$(date +%F).db"` → gzip、14世代保持。任意で rclone によるオフサイト退避。（将来 Litestream によるレプリケーションも選択肢）

### CI/CD（GitHub Actions）

```text
on: push(main)
  job quality:  npm ci → lint → typecheck → test → build      # Quality Gates と同一コマンド
  job image:    docker build → push ghcr.io/{owner}/next-call:latest + :sha   (needs: quality)
  job deploy:   ssh VPS → docker compose pull && docker compose up -d
                → curl https://{domain}/api/health で確認      (needs: image)
```

- Secrets: `VPS_SSH_KEY` / `VPS_HOST` / `VPS_USER`（GHCR は `GITHUB_TOKEN` で可）。
- アプリ環境変数（VPS側 `.env`）: `DATABASE_PATH`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `ALLOWED_EMAILS`, `AUTH_URL`。
- 電波不安定な店内利用（Clarification）への対策はMVPでは「クラウドDB+リトライ表示」まで。オフラインキュー/PWA化は後続インテント。

## Data Import Plan

初期データ: 曲マスター（数百曲）+ セットリスト履歴（約5年分、iPhoneメモ由来）。**実データのフォーマットは未入手**（Open Questions #1）のため、以下のCSV仕様をアプリ側の受け口として定義し、ユーザーのメモ→CSV変換は別途支援する。

### 曲マスターCSV（songs.csv）

```csv
title,key,form,composer,has_played,no_chart_ok,is_standard,simple_form,in_kurobon1,season,listener_level,energy_level,genres,note
Stella By Starlight,Bb,AABA,Victor Young,1,1,1,0,1,通年,4,3,歌もの,
Recorda Me,C,OTHER,Joe Henderson,1,0,0,0,1,通年,3,3,ボサノバ,
```

- form: `AABA / ABAC / BLUES12 / OTHER`、season: `春/夏/秋/冬/通年`（省略時=通年）、boolean: `1/0`
- genres: `|` 区切り複数可（例: `3拍子|歌もの`）。9種の固定語彙以外はエラー
- listener_level / energy_level: 1–5、省略時 3
- title で upsert（正規化: 全半角・大小・前後空白）

### セットリスト履歴CSV（setlists.csv）

```csv
date,venue_name,order,title,participated,instrument,called_by_me,no_chart,memo
2024-05-12,某店,1,Alone Together,1,sax,1,0,
2024-05-12,某店,2,Blue Bossa,0,,0,0,
```

- `date + venue_name` でセッションを自動生成（同一組は1セッションに集約、order で並び順）
- instrument: `sax / piano / 空`（participated=0 なら空）
- venue_name が未登録の場合: プレビュー画面で某店/某店以外の区分をまとめて確定してから取込

### インポートフロー（4段階）

1. **アップロード** → Zodで行単位バリデーション
2. **プレビュー**: エラー行一覧（行番号+理由）、未知の店舗の区分確定UI、曲名不一致の解決UI（既存曲へのマッチ候補提示 / 新規曲スタブ作成 / スキップ）
3. **ドライラン差分表示**: 新規曲n件・新規セッションn件・更新n件
4. **コミット**: 単一トランザクションで取込。完了後に has_played 再計算オプション（participated=1 の履歴がある曲を ON）

## UI Mockup: セッション記録画面（主画面）

**Source:** collaborative（デザインファイルなし。docs/design_rule.md 準拠、モバイル幅想定）
※ 議論用にラベルは英語表記。実装UIは日本語（例: Suggest next call = 次の曲を考える）。

### Layout

```
┌──────────────────────────────────────────────────┐
│ next-call            2026-07-12    [End session] │
│ Venue: Jazz Spot XYZ   (badge: Home)             │
│ Listeners:  [ Yes | *No ]  (toggle)              │
├──────────────────────────────────────────────────┤
│ Setlist                                          │
│  1. Stella By Starlight     sax  CALL      [...] │
│  2. Alone Together          --   --        [...] │
│  3. Blue Bossa              pf   --        [...] │
│                                                  │
│  [+ Add song]                                    │
├──────────────────────────────────────────────────┤
│           [ Suggest next call ]  (Primary)       │
└──────────────────────────────────────────────────┘
```

曲追加（ボトムシート / shadcn Dialog）:

```
┌──────────────────────────────────────────────────┐
│ Add performed song                               │
│  Song title  [ incremental search............. ] │
│  My part     ( )sax   ( )piano   (*)none         │
│  Called by me [ ]      No chart [ ]              │
│  Memo        [.............................. ]   │
│                          [Cancel]   [Add]        │
└──────────────────────────────────────────────────┘
```

### Interactions

- Listeners トグル: セッション中いつでも即時保存（§4.3）
- 曲行の [...]: 編集/削除メニュー。行タップで参加楽器・コール有無をその場修正
- Add song: 曲名インクリメンタル検索（曲マスター）。未登録曲は「新規登録して追加」導線（最低限 title のみで作成、属性は後で）
- 自分の参加=none の場合 instrument 選択は無効化。called_by_me=ON でコール曲として記録
- Suggest next call: 選曲支援画面へ遷移（Primaryボタンは画面内1つ = design_rule §9）
- End session: 確認ダイアログ → status=ENDED

### Data Mapping

- ヘッダ ← Session.session_date / Venue.name / Venue.is_home / Session.has_listeners
- Setlist 行 ← Performance（order_index 順）+ Song.title
- 楽器表示 ← Performance.instrument（sax/pf/--）、CALL ← called_by_me

## UI Mockup: 選曲支援画面（編成・意図）

**Source:** collaborative

### Layout

```
┌──────────────────────────────────────────────────┐
│ [< Back]        Next call                        │
├──────────────────────────────────────────────────┤
│ Formation (next tune)                            │
│  Horns:     (*)one    ( )multi    ( )unknown     │
│  Beginner:  (*)none   ( )present  ( )unknown     │
│                                                  │
│ Constraints                                      │
│  Kurobon1 only  [ ]                              │
│  > Genre override (collapsed by default)         │
├──────────────────────────────────────────────────┤
│ Intent (carried over from last request)          │
│  Rare song        [---|---|-*-|---|---]          │
│  Long-unplayed    [---|---|---|-*-|---]          │
│  Safe   <-> Bold  [---|-*-|---|---|---]          │
│  Calm   <-> Lift  [---|---|-*-|---|---]          │
│  Ballad avoid<->want [---|---|-*-|---|---]       │
│  [x] Seasonal (autumn)   [ ] Listener-friendly   │
├──────────────────────────────────────────────────┤
│           [ Get candidates ]  (Primary)          │
└──────────────────────────────────────────────────┘
```

### Interactions

- 全スライダー5段階（−2..+2）、前回値を初期表示（§9）。中央=何もしない
- Seasonal: 現在の季節を括弧内に自動表示（利用者は季節を選ばない §9.7）。セッション1曲目はデフォルトON
- Genre override: 折りたたみを開くとジャンルチップ（7種: ボサノバ/3拍子/モード/ファンク/ブルース/歌もの/循環。バラードは独立スライダーのため除外 §10.2）。複数選択=ORフィルタ
- Get candidates: 推薦実行 → 結果画面へ（同一画面下部への差込みでも可）

### Data Mapping

- Formation/Constraints ← RecommendationRequest.horns / beginner / kurobon1_only / genre_override
- Intent ← SelectionIntent（前回値 carry-over）
- Seasonal の自動季節 ← Session.session_date + Setting engine.season_months

## UI Mockup: 推薦結果表示

**Source:** collaborative

### Layout

```
┌──────────────────────────────────────────────────┐
│ Candidates (3)                    [Re-roll]      │
│ ┌──────────────────────────────────────────────┐ │
│ │ I Remember You        key:F  AABA  (PENDING) │ │
│ │  - 1y2m since you last played it             │ │
│ │  - Rare at this venue (2y: once)             │ │
│ │  - Key/form/feel differ from previous        │ │
│ │            [ Call this ]   [ Hold ]          │ │
│ └──────────────────────────────────────────────┘ │
│  (+2 more cards)                                 │
│                                                  │
│ If horns = unknown:                              │
│ ┌──────────────────────────────────────────────┐ │
│ │ For multi horns: Softly ... (reasons)        │ │
│ └──────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────┤
│ Pending songs (always shown)                     │
│  - Song D   [! played today]   [Call] [Release]  │
│  - Song E                      [Call] [Release]  │
└──────────────────────────────────────────────────┘
```

### Interactions

- 各候補: 推薦理由を複数行表示（固定テンプレート §15.1）。Call this → Performance 作成（called_by_me=ON, instrument 既定 sax）→ 記録画面へ戻る。Hold → PendingSong 登録（カードに PENDING バッジ）
- Re-roll: 同条件で重み付き再抽選（RecommendationRequest は新規保存 → 繰り返し減点が効く）
- 候補が3未満のとき: 「条件に合う曲が少ないため n 曲のみ表示」と明示（§14.5）
- 保留曲: 無条件で全件表示。除外条件該当時は警告バッジ（played today / same form / not in Kurobon1 / hard for this formation）。Call 時に「保留を解除しますか？」確認（Provisional #12）

### Data Mapping

- 候補カード ← RecommendationCandidate.score/reasons + Song（title/key/form）
- 条件別候補 ← candidate_type = ONE_HORN/MULTI_HORN/BEGINNER
- 保留曲 ← PendingSong + 完全除外チェックの再評価結果（警告バッジ）

## UI Mockup: 曲マスター / インポート / 設定（概要）

**Source:** collaborative

### Layout

```
┌──────────────────────────────────────────────────┐
│ Songs (312)   [Search......]  [+ New]  [Import]  │
│ ┌──────────────────────────────────────────────┐ │
│ │ Title            Key  Form   L  E  Genres    │ │
│ │ Alone Together   F    AABA   3  3  --        │ │
│ │ Blue Bossa       C    OTHER  4  3  bossa     │ │
│ └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────┐
│ Import  (step 2/4: Preview)                      │
│  songs.csv: 298 ok / 3 errors                    │
│  - line 41: unknown genre "swing"                │
│  New venues: [Jazz Bar ABC]  Home? ( )Y (*)N     │
│  Unmatched titles: 2  -> [resolve...]            │
│              [Back]   [Dry-run diff]             │
└──────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────┐
│ Settings                                         │
│  Aggregation window (days)      [730 ]           │
│  Same-key penalty               [15  ]           │
│  ... (all engine.* keys, grouped)                │
│  Season months / Candidate count / tau ...       │
│                         [ Save ]                 │
└──────────────────────────────────────────────────┘
```

### Interactions

- 曲マスター一覧: L(listener_level)/E(energy_level) はインライン編集可（Data Gaps #4 の段階的整備用）。行タップで詳細編集（全属性+ジャンルチップ）
- インポート: 4段階ウィザード（Data Import Plan 参照）
- 設定: engine.* をグループ表示、Zod検証、保存即反映（次回推薦から有効）

### Data Mapping

- 一覧 ← Song + song_genres、設定 ← Setting（key-value）

## Quality Gate Candidates

Greenfield のため既存ツーリングなし。導入予定スタック（Next.js + TypeScript + Vitest + ESLint）から以下を提案する。package.json の scripts に定義し、CI（GitHub Actions quality ジョブ）と同一コマンドにする。

| Gate | Command | Source |
|---|---|---|
| typecheck | `npm run typecheck`（tsc --noEmit） | tsconfig.json（導入予定） |
| lint | `npm run lint`（eslint .） | eslint.config（導入予定） |
| tests | `npm run test`（vitest run） | vitest.config（導入予定。推薦エンジン純関数が主対象） |
| build | `npm run build`（next build） | next.config（導入予定） |

```yaml
quality_gates:
  - name: typecheck
    command: npm run typecheck
  - name: lint
    command: npm run lint
  - name: tests
    command: npm run test
  - name: build
    command: npm run build
```

## Open Questions

1. **iPhoneメモの実データフォーマット未入手**: セットリスト履歴・曲マスターの現物サンプルの提供が必要。CSV変換は誰が/どう行うか（変換スクリプト支援の要否）。
2. **某店の実店舗名と表記揺れ**: 自動判定（`home_venue_names` 照合）の初期値として実名が必要。
3. **PiaScore季節セットリストの移行**: 手動転記（CSV season 列）でよいか。曲数の目安は。
4. **保留曲コール時の自動解除**: 暫定「自動解除せず確認ダイアログ」でよいか（§21）。
5. **listener_level / energy_level の初期付与**: デフォルト3で開始し段階整備、で運用上問題ないか。CSVに含めて一括投入するか。
6. **「ヴォーカル参加曲の後は歌ものを避ける」(§12.5)**: 演奏記録に「ヴォーカル参加」フラグを追加するか、直前曲の歌もの属性による連続回避（§12.3）で代替してよいか（暫定: 代替）。
7. **累計コール回数上位10曲（§12.7）の集計期間**: 全期間でよいか（暫定: 全期間）。
8. **ジャンル上書きの意味**: 「フィルタ（絞り込み）」でよいか、「強い加点」にすべきか（暫定: フィルタ）。
9. **推薦履歴の「同じような条件」判定粒度**: 暫定 = horns + beginner + kurobon1_only + genre_override + 各スライダーの符号（−/0/+）のシグネチャ一致。これで十分か。
10. **VPS環境の詳細**: OS、既存リバースプロキシ（Nginx等）の有無、ドメイン名、GHCR利用可否（Docker Hub代替の要否）、バックアップ先。
11. **Googleログインの許可メールアドレス**: `ALLOWED_EMAILS` に設定する実アドレス（複数端末・複数アカウントの想定有無）。
12. **セッション基本情報の「その他、既存のiPhoneメモで管理している情報」（§4.1）**: note 1フィールドで足りるか、構造化すべき項目が他にあるか。

---

## Domain Model Review Decisions（2026-07-12 ユーザーレビュー確定事項）

ドメインモデルは「正確に捉えている」で承認。以下の4点を確定:

1. **フロント編成の記録（§12.5ギャップ対応・ユーザー指定）**: Performance にフロント編成を記録する。
   - 楽器コード: `vo, ss, as, ts, bs, tp, fl, fh, harm, tb, cl, g`（ヴォーカル/ソプラノSax/アルトSax/テナーSax/バリトンSax/トランペット/フルート/フリューゲルホルン/ハーモニカ/トロンボーン/クラリネット/ギター）
   - 楽器マスターは追加可能（設定またはマスター管理から）
   - **順序付き・重複可の複数登録**（例: `vo, as, as, ts` = ヴォーカル+アルト2+テナー）→ InstrumentマスターとPerformanceFrontInstrument（performance_id, instrument_code, position）の設計とする
   - §12.5「歌ものはヴォーカル参加曲の後は避ける」は **直前Performanceのフロント編成に `vo` が含まれるか** で判定
   - 入力は任意（未入力なら判定はスキップ＝減点なし）
2. **保留曲のコール時**: 演奏登録した曲が保留中なら**自動で解除**する
3. **ジャンル上書き**: フィルタではなく**強い加点**（指定ジャンルを優先しつつ他ジャンルの曲も候補に残る）。暫定値: +15点/指定ジャンル該当（設定 `engine.genre_override_bonus`）
4. ドメインモデル本体（エンティティ10種+関係）: 承認済み。上記1により Instrument / PerformanceFrontInstrument を追加
