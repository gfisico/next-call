---
status: success
error_message: ""
findings_count: 13
auto_fixable_count: 10
categories_found: [contradiction, hidden-complexity, assumption, dependency, completeness, boundary]
---

# Adversarial Review Results

## Summary

- **Total findings:** 13
- **Blocking:** 0
- **Warning:** 13
- **Suggestion:** 0
- **Auto-fixable:** 10 (high-confidence with automatable fix_type)

## Categories

- **contradiction:** 5 findings
- **hidden-complexity:** 1 findings
- **assumption:** 1 findings
- **dependency:** 2 findings
- **scope:** 0 findings
- **completeness:** 3 findings
- **boundary:** 1 findings

## Findings

```yaml
- id: F001
  category: completeness
  confidence: high
  severity: warning
  affected_units: [unit-02-recommendation-engine, unit-04-recommendation-api]
  title: "horns と beginner が両方 UNKNOWN のときの条件別候補の仕様が未定義"
  description: >
    unit-02 の conditional.ts は「horns/beginner が UNKNOWN のとき各2ブランチで再実行」と
    定めるが、両方が同時に UNKNOWN の場合の挙動（4組み合わせを実行するのか、各軸2ブランチ
    ずつ計4本なのか、その際もう一方の軸をどの値として扱うのか）が未規定。一次仕様§8.1/§8.2/
    §15.2 も個別軸の記述のみで組み合わせを定義していない。unit-06 は初期表示で編成・初心者
    とも「わからない」を既定とするため、これは例外ケースではなく最初の推薦実行で必ず通る
    最頻パスであり、ビルダーごとに解釈が分かれる。
  evidence: >
    unit-02-recommendation-engine.md line 40: 「horns/beginner が UNKNOWN のとき各2ブランチで
    再実行し…」（同時UNKNOWNの規定なし）。unit-06-recommend-screen.md line 42(項1):
    「編成は『わからない』既定」。docs/jazz_session_song_recommendation_spec_v2.md §15.2 も
    軸ごとの記述のみ。
  suggested_fix: >
    unit-02 の conditional.ts 仕様に組み合わせ規則を明記する。例:「各軸を独立に分岐し、
    分岐しない側の軸は入力値（UNKNOWN のままの通常候補ロジック=除外・減点なし）を維持する。
    ブランチは最大4本（1管/複数管/初心者なし/初心者あり）で、組み合わせブランチ
    （1管×初心者あり等）は生成しない」。あわせて成功基準の条件別候補テストに
    「horns=UNKNOWN かつ beginner=UNKNOWN」ケースを追加する。
  fix_type: spec_edit
  fix_target: unit-02-recommendation-engine.md
- id: F002
  category: completeness
  confidence: high
  severity: warning
  affected_units: [unit-02-recommendation-engine]
  title: "直前曲が存在しない場合（セッション1曲目）のエンジン挙動が未規定"
  description: >
    エンジンのルールのうち少なくとも6つ（直前曲と同form完全除外、同キー減点、特殊ジャンル
    連続減点、同作曲者減点、§12.5 vo減点、理由テンプレート「直前曲とキー・構成・雰囲気が
    変わる」）が直前 Performance を参照するが、演奏記録0件のセッションで推薦を実行した場合
    （EngineInput の直前曲が存在しない場合）の挙動が unit-02 に一切書かれていない。
    1曲目での推薦は仕様§9.7（1曲目の季節感デフォルトON）が明示的に想定するユースケースで
    あり、必ず発生する。null 安全の規定がないとクラッシュまたは実装ごとの差異を生む。
  evidence: >
    unit-02-recommendation-engine.md lines 34-36: 除外・減点ルールが「直前曲」を多数参照
    するが、直前曲なしの規定・テストが Success Criteria（lines 44-53）に存在しない。
    needs_review 曲の安全側処理（line 34, 51）はあるが直前曲不在は対象外。
  suggested_fix: >
    unit-02 に「直前 Performance が存在しない場合、直前曲参照ルール（同form除外・同キー・
    特殊ジャンル連続・同作曲者・§12.5）はすべてスキップする（減点・除外なし）」を明記し、
    成功基準に「演奏記録0件（直前曲なし）の入力でクラッシュせず、直前曲系ルールが
    発火しない境界テスト」を追加する。
  fix_type: add_criterion
  fix_target: unit-02-recommendation-engine.md
- id: F003
  category: contradiction
  confidence: high
  severity: warning
  affected_units: [unit-01-app-foundation, unit-02-recommendation-engine, unit-07-master-settings-screen]
  title: "engine.after_vocal_vocal_penalty のみ負値（-15）で、他の減点キーの正値慣習と矛盾"
  description: >
    discovery.md「Provisional Values」の減点系設定キーはすべて正値で定義されている
    （same_key_penalty = 15, multi_horn_vocal_penalty = 15, blues_penalty = 10,
    same_composer_penalty = 5, top_called_penalty = 12, low_freq_penalty = 8）のに対し、
    #16 の after_vocal_vocal_penalty だけが「-15」と負値で定義されている。unit-01 はこの表を
    「設定キー初期値の唯一の情報源」としてシードし、unit-02 は EngineConfig で受け取って
    スコアから減点する。符号の慣習が1キーだけ逆だと、二重否定（score -= -15 → +15 の加点）
    や設定画面（unit-07）での表示不整合を起こす典型的なトラップになる。
  evidence: >
    discovery.md line 282: 「`engine.after_vocal_vocal_penalty = -15`」 vs line 270:
    「`engine.same_key_penalty = 15`」、line 272: 「`engine.multi_horn_vocal_penalty = 15`」
    ほか lines 296-298 の減点キーはすべて正値。
  suggested_fix: >
    discovery.md の #16 を `engine.after_vocal_vocal_penalty = 15`（正値、減点として適用）に
    統一し、unit-02 の該当記述（「既定−15」）は「既定15を減点として適用」と読み替えられる
    表現に揃える。
  fix_type: spec_edit
  fix_target: discovery.md
- id: F004
  category: contradiction
  confidence: high
  severity: warning
  affected_units: [unit-02-recommendation-engine, unit-06-recommend-screen]
  title: "ジャンル上書き=「フィルタ」の記述が discovery.md に3箇所残存（確定事項は「強い加点」）"
  description: >
    ユーザー確定事項（Domain Model Review Decision 3、Provisional #15、Stage 3、unit-02/06）
    ではジャンル上書きは「フィルタではなく強い加点 +15」だが、discovery.md 内に旧記述が
    3箇所残っている: Provisional Values #7「OR条件のフィルタ」、UI Mockup 選曲支援画面
    「複数選択=ORフィルタ」、Open Questions #8「（暫定: フィルタ）」。unit-01/unit-02 は
    Provisional Values の表を「唯一の情報源」と宣言しているため、同じ表の中で #7 と #15 が
    矛盾しているのは実装誤りの直接の温床になる。
  evidence: >
    discovery.md line 275（#7: 「OR条件の**フィルタ**」）、line 523（UI Mockup:
    「複数選択=ORフィルタ」）、line 649（OQ#8: 「暫定: フィルタ」） vs line 281（#15:
    強い加点+15）・line 180（Stage 3: 強い加点）・line 668（確定事項）。
  suggested_fix: >
    discovery.md の #7 を「ジャンルチップ複数選択。指定ジャンル該当曲へ強い加点（#15参照）。
    フィルタではない」に修正し、UI Mockup の「ORフィルタ」を「OR条件の強い加点」に、
    Open Questions #8 に「→ 強い加点で確定（Domain Model Review 3）」の解決済み注記を付ける。
  fix_type: spec_edit
  fix_target: discovery.md
- id: F005
  category: contradiction
  confidence: high
  severity: warning
  affected_units: [unit-04-recommendation-api, unit-06-recommend-screen]
  title: "保留曲コール時の自動解除について旧記述（確認ダイアログ・暫定OFF）が discovery.md に残存"
  description: >
    確定事項（Provisional #12、Domain Model Review Decision 2、intent.md、unit-04）は
    「コール時に自動解除する」だが、discovery.md に旧仕様が3箇所残っている: Lifecycle
    「コール時の自動解除は暫定OFF+確認ダイアログ」、UI Mockup 推薦結果「Call 時に
    『保留を解除しますか？』確認（Provisional #12）」（しかも #12 は自動解除と書いてあり
    参照先と本文が食い違う）、Open Questions #4「暫定『自動解除せず確認ダイアログ』」。
    unit-06 のビルダーが UI Mockup を出発点にすると、不要な確認ダイアログを実装して
    unit-04 の自動解除と挙動が衝突する。
  evidence: >
    discovery.md line 127（Lifecycle: 「自動解除は暫定OFF+確認ダイアログ」）、line 566
    （UI Mockup: 「Call 時に『保留を解除しますか？』確認」）、line 645（OQ#4） vs
    line 280（#12: 自動で解除する・ユーザー確定）、unit-04-recommendation-api.md
    「コール時自動解除」。
  suggested_fix: >
    discovery.md の Lifecycle・UI Mockup 推薦結果の Interactions・Open Questions #4 を
    「called_by_me=true の演奏登録で自動解除（確認ダイアログなし）」に統一する。
  fix_type: spec_edit
  fix_target: discovery.md
- id: F006
  category: contradiction
  confidence: high
  severity: warning
  affected_units: [intent.md, unit-08-csv-import-api]
  title: "intent.md は「実データフォーマット未入手」だが discovery.md では Excel 実データ確認済み"
  description: >
    intent.md の Data Sources / Data Gaps は「iPhoneメモ…実データフォーマット未入手」
    「インポート実装前にサンプル提供が必要」と記載するが、discovery.md「Excel Source
    Analysis」では初期データの実体は Excel（やれる曲.xlsx、list 733曲・logs_all 2,293行）で
    実データ確認済み・列マッピングまで確定しており、unit-08 のリスク欄も「実データは
    確認済み」と記載する。discovery.md 自身にも旧記述が残る（Data Sources「未入手」、
    Data Import Plan 冒頭「実データのフォーマットは未入手」、Open Questions #1）。
    intent の Data Gaps を信じたビルダー/レビュアーは unit-08 を「ブロック中」と誤認する。
  evidence: >
    intent.md line 66: 「実データフォーマット未入手」、line 71: 「インポート実装前に
    サンプル提供が必要」 vs discovery.md line 681前後「Excel Source Analysis（2026-07-12
    実データ確認済み）」・unit-08-csv-import-api.md Risks「実データは確認済み
    （/Users/fisico/Downloads/やれる曲.xlsx…）」。discovery.md lines 136/402/642 にも
    旧記述が残存。
  suggested_fix: >
    intent.md の Data Sources を「Excel（やれる曲.xlsx、約5年分の履歴+曲マスター。実データ
    確認済み・733曲/2,293行）→ 初回抽出スクリプトで songs.csv/setlists.csv に変換して取込」
    に更新し、Data Gaps の当該項目を「表記揺れ・想定外書式が残るリスク（unit-08 の警告
    リストで対応）」に置換する。discovery.md の lines 136/402/642 にも解決済み注記を付ける。
  fix_type: spec_edit
  fix_target: intent.md
- id: F007
  category: contradiction
  confidence: high
  severity: warning
  affected_units: [unit-03-master-session-api, unit-04-recommendation-api, unit-02-recommendation-engine]
  title: "discovery.md の技術方針（Server Actions・src/lib/engine・ルート構成）がユニット仕様と乖離"
  description: >
    discovery.md は「ミューテーション: Server Actions」「書き込みは Server Actions 経由のみ」
    と定めるが、unit-03/unit-04 は Next.js Route Handlers（app/api/ の REST API）で全書き込み
    を実装する設計であり、直接矛盾する。またディレクトリ構成案は src/lib/engine/
    （exclusions.ts/scoring.ts/pool.ts/draw.ts）だが unit-02 は src/engine/（exclude.ts/
    score.ts/select.ts/conditional.ts 等）、画面ルート案（sessions/[id]/suggest, pending/,
    import/, venues/）も units の views（/sessions/[id]/recommend, /settings/import,
    保留曲は推薦画面内・店舗は設定内）と食い違う。discovery.md はビルダーが必読の参照文書
    のため、どちらに従うべきか判断がぶれる。
  evidence: >
    discovery.md line 312: 「ミューテーション | Server Actions」、line 366: 「書き込みは
    Server Actions 経由のみ」、line 353: 「lib/engine/ … exclusions.ts scoring.ts … pool.ts
    draw.ts」、lines 336-343: ルート構成案 vs unit-03-master-session-api.md「Next.js Route
    Handlers（app/api/）」・unit-02-recommendation-engine.md lines 26/32: 「src/engine/」・
    unit-06/07 の views。
  suggested_fix: >
    discovery.md の Tech Stack 表・データアクセス層方針・ディレクトリ構成案・ルート構成案を
    units の確定内容（Route Handlers による API 層、src/engine/、/sessions/[id]/recommend、
    /settings 配下）に合わせて更新するか、各所に「※構成はユニット仕様が優先（本節は初期案）」
    の注記を追加する。
  fix_type: spec_edit
  fix_target: discovery.md
- id: F008
  category: completeness
  confidence: medium
  severity: warning
  affected_units: [unit-02-recommendation-engine]
  title: "理由生成の「最低2件保証」とトリガー発火型テンプレートが両立しないケースのフォールバック未定義"
  description: >
    unit-02 は「各候補に最低2件付くこと」「発火していないルールの理由が出ない」の両方を
    成功基準にするが、理由はトリガー発火型テンプレート（discovery.md Stage 8 の10種）のみ。
    スライダー全中央・季節/リスナーOFF・登場回数が中程度・最終演奏が最近、のような曲では
    発火するテンプレートが0〜1件になり得るため、2つの基準が衝突する。フォールバック理由の
    定義がないとビルダーは「発火していない理由を捏造する」か「2件未満を許す」かの
    どちらかで基準違反になる。
  evidence: >
    unit-02-recommendation-engine.md line 39: 「固定テンプレート最大4件/曲…各候補に最低2件
    付くこと」、line 50: 「各候補に2件以上の理由が付き、発火していないルールの理由が出ない」。
    discovery.md Stage 8 のテンプレート表はすべて条件付きトリガーで、無条件に出せる
    フォールバック文が存在しない。
  suggested_fix: >
    discovery.md Stage 8 とunit-02 に、常に生成可能な事実ベースのフォールバックテンプレート
    （例:「黒本キー{key}・{form}構成」「この2年で{a}回演奏」「スコア上位{rank}位の候補」）を
    定義し、「発火理由が2件未満の場合のみフォールバックで2件まで補完する」規則を明記する。
  fix_type: spec_edit
  fix_target: unit-02-recommendation-engine.md
- id: F009
  category: dependency
  confidence: high
  severity: warning
  affected_units: [unit-08-csv-import-api, unit-04-recommendation-api]
  title: "unit-08 の成功基準が unit-04 の集計関数を要求するが depends_on に unit-04 がない"
  description: >
    unit-08 の成功基準「取込後、登場回数・久しぶり度の集計（unit-04 の関数）に履歴が
    反映される（結合テスト）」は unit-04 の成果物を直接使用するが、unit-08 の depends_on は
    [unit-01, unit-03] のみ。括弧書きで「unit-04完成後にCIで有効化してよい」と逃がしている
    ものの、ユニット完了時に検証できない成功基準が残ると、レビュアーが unit-08 を完了と
    判定できない（または未検証のまま完了扱いになる）。依存を張ると unit-08 の並行実行が
    失われるため、基準の置き場所を変えるのが妥当。
  evidence: >
    unit-08-csv-import-api.md line 78: 「登場回数・久しぶり度の集計（unit-04 の関数）に
    履歴が反映される（結合テスト。unit-04完成後にCIで有効化してよい）」 vs frontmatter
    depends_on: [unit-01-app-foundation, unit-03-master-session-api]。
  suggested_fix: >
    当該基準を unit-08 から削除し、unit-04 の成功基準（または intent の一括インポート成功
    基準の検証手順）へ「インポート済み履歴が集計に反映される結合テスト」として移設する。
    unit-08 側には「setlists 取込が performances テーブルに正しい日付・called_by_me で
    保存される」というユニット内で検証可能な基準を残す。
  fix_type: spec_edit
  fix_target: unit-08-csv-import-api.md
- id: F010
  category: boundary
  confidence: high
  severity: warning
  affected_units: [unit-05-session-screen, unit-06-recommend-screen]
  title: "unit-06 が再利用する曲追加シートの部品化要件が unit-05 側に存在しない"
  description: >
    unit-06 は「候補の『この曲をコール』→ unit-05 の曲追加シートを called_by_me=true・
    曲確定済みの状態で開く」「曲追加シートは unit-05 の部品を再利用（重複実装しない）」と
    定めるが、提供側の unit-05 には曲追加シートを再利用可能なコンポーネント（初期値注入・
    保存後の遷移先制御が可能）として実装する要件も成功基準もない。unit-05 のビルダーが
    ホーム画面に密結合した実装をすると、unit-06 で作り直しか重複実装（unit-06 の
    Boundaries 違反）の手戻りが発生する。
  evidence: >
    unit-06-recommend-screen.md line 55: 「unit-05 の曲追加シートを called_by_me=true・
    曲確定済みの状態で開く」、line 75: 「曲追加シートは unit-05 の部品を再利用（重複実装
    しない）」 vs unit-05-session-screen.md lines 44-52: 曲追加シートの仕様に再利用・
    外部からの初期値注入への言及なし。Success Criteria にも該当基準なし。
  suggested_fix: >
    unit-05 の Technical Specification に「曲追加シートは初期値（song 固定、called_by_me、
    instrument 既定）と保存後コールバック/遷移先を props で受け取る共有コンポーネントとして
    実装する（unit-06 が再利用する契約）」を追記し、成功基準に「曲確定済み+called_by_me=true
    の初期状態でシートを開くテスト」を追加する。
  fix_type: add_criterion
  fix_target: unit-05-session-screen.md
- id: F011
  category: dependency
  confidence: medium
  severity: warning
  affected_units: [unit-06-recommend-screen, unit-07-master-settings-screen]
  title: "Apple(iOS)風カスタムスライダーの共有方法が未定義（unit-07 は unit-06 に依存していない）"
  description: >
    unit-06 は Apple(iOS)風カスタムスライダーを実装し「unit-07 の設定画面スライダーも
    同スタイルに統一」と定め、unit-07 も「unit-06 と同じ Apple(iOS)風スタイル」を要求する。
    しかし unit-07 の depends_on は [unit-03, unit-08] で unit-06 を含まず、実行順も保証
    されない（unit-07 が unit-06 より先に完了し得る）。共有コンポーネントの置き場所と
    実装責任が未定義のため、重複実装かスタイル乖離のリスクがある。
  evidence: >
    unit-06-recommend-screen.md line 46: 「unit-07 の設定画面スライダーも同スタイルに統一」、
    unit-07-master-settings-screen.md line 47: 「（unit-06 と同じ Apple(iOS)風スタイル）」 vs
    unit-07 frontmatter depends_on: [unit-03-master-session-api, unit-08-csv-import-api]。
  suggested_fix: >
    カスタムスライダーを共有UIコンポーネント（components/ui/ios-slider 等）として実装する
    責任を unit-06 に明記し、unit-07 には「unit-06 が先に完了していれば共有コンポーネントを
    使用、未完了なら暫定で標準 Slider を使い unit-06 完了後に差し替える」か、unit-07 の
    depends_on に unit-06 を追加するかのどちらかを明記する。
  fix_type: spec_edit
  fix_target: unit-07-master-settings-screen.md
- id: F012
  category: assumption
  confidence: high
  severity: warning
  affected_units: [unit-09-infra-deploy]
  title: "backup.sh の /data パスはコンテナ内パスで、ホスト cron からの実行前提と不整合"
  description: >
    unit-09 の backup.sh は「sqlite3 /data/next-call.db \".backup\"」と定めるが、/data は
    コンテナ内のマウント先で、ホスト側の実パスは /srv/next-call/data（compose の volume
    定義）。バックアップは「VPS の cron」で実行するため、ホストから /data は見えない。
    さらに実行 stage の slim イメージに sqlite3 CLI が含まれる保証はなく、ホストへの
    sqlite3 インストール手順も ops.md の項目に含まれていない。このままでは backup.sh が
    どこで動く想定なのか（ホスト直接 or docker exec）をビルダーが推測することになる。
  evidence: >
    unit-09-infra-deploy.md line 53: 「`sqlite3 /data/next-call.db \".backup\"`」、line 54:
    「週次実行（VPS の cron…）」 vs line 46: 「volume /srv/next-call/data:/data」。
    line 58 の ops.md 項目に sqlite3 CLI 導入手順なし。
  suggested_fix: >
    unit-09 に実行方式を明記する。例:「backup.sh はホスト cron から実行し、ホストパス
    /srv/next-call/data/next-call.db を対象に、ホストにインストールした sqlite3 CLI
    （apt install sqlite3。ops.md のセットアップ手順に追加）で .backup を実行する」。
    もしくは docker exec 経由とする場合はイメージに sqlite3 を含める旨を Dockerfile 仕様に
    追記する。
  fix_type: spec_edit
  fix_target: unit-09-infra-deploy.md
- id: F013
  category: hidden-complexity
  confidence: medium
  severity: warning
  affected_units: [unit-01-app-foundation, unit-04-recommendation-api, unit-09-infra-deploy]
  title: "タイムゾーンの取り扱いが全ユニットで未規定（session_date 既定=当日・季節判定・日数集計に影響）"
  description: >
    session_date の既定=当日（unit-03）、季節判定（セッション日付+区切り月）、
    「久しぶり」日数・30日/730日ウィンドウ（unit-02/04）、バックアップのファイル名日付
    （unit-09）がすべて「現在日付」に依存するが、タイムゾーンの規定がどこにもない。
    Docker コンテナの既定 TZ は UTC のため、ジャズセッションで現実的な JST 深夜帯
    （21時〜翌1時）に「当日」の解釈が JST とずれ、session_date が意図しない日付になったり
    集計ウィンドウが最大9時間ずれる。環境変数一覧（unit-01/unit-09 の .env）にも TZ がない。
  evidence: >
    unit-03-master-session-api.md: 「session_date 既定=当日」、unit-04-recommendation-api.md:
    「現在季節はセッション日付+設定の区切り月から算出」「直近5リクエスト（30日）」、
    unit-01-app-foundation.md line 41 と unit-09-infra-deploy.md line 40 の環境変数一覧に
    TZ の定義なし。
  suggested_fix: >
    unit-01 に「日付の解釈は JST（Asia/Tokyo）を正とする。コンテナ/開発環境に TZ=Asia/Tokyo
    を設定し（compose の environment と .env 一覧に追加）、『当日』の算出はこの TZ で行う」
    を明記し、unit-09 の .env 一覧に TZ を追加する。
  fix_type: spec_edit
  fix_target: unit-01-app-foundation.md
```
