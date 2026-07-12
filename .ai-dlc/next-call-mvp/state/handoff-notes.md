# 後続ユニットへの申し送り

## from unit-02 レビュー（low・非ブロッキング）
- **unit-07（設定画面）**: EngineConfig.longUnplunplayedDays（365）は実装未使用（理由閾値は m_old≥0.5 で判定、既定値では等価）。設定画面でこのキーを公開する場合は実装との接続を確認すること
- **unit-04（推薦API）**: genreCallRatios に無いジャンルは低頻度減点がスキップされる（安全側）。EngineInput 組み立て時に全ジャンルの比率を渡すこと

## from unit-01 レビュー（low・非ブロッキング）
- **unit-05/06/07（画面）**: testing-library 未導入。画面テストで導入が必要
- **Toast**: sonner の Toaster がレイアウト未マウント。Toast を使う最初の画面ユニットでマウントすること

## from unit-03 レビュー（low・非ブロッキング）+ API規約
- **API規約（全後続ユニット）**: JSON/クエリは camelCase、POST=201・DELETE=204、リソース名エンベロープ（{ song } / { sessions } 等）、エラーは { error: { code, message, details? } }。zodスキーマは src/server/validation/、エラー定義は src/server/http/errors.ts
- **unit-05（曲管理画面）**: POST /api/songs の重複判定は raw title 一致のみ（正規化判定はquick登録のみ）。画面側で気になれば followup 候補
- **unit-08**: normalize-title（src/lib/normalize-title.ts）とリポジトリ関数を再利用可能
- markSongPlayed は PATCH のたび songs.updatedAt を更新（sort=updated が演奏記録編集で動く・実害軽微）

## from unit-04（推薦API完成）
- **unit-06（選曲支援画面）**: POST /api/sessions/:id/recommendations、GET .../recommendations/defaults、保留曲API が利用可能。レスポンスに poolSize（Stage1通過数）あり=候補が少ない時の緩和表示に使える。isSparse フラグも返る
- **unit-08（CSVインポート）**: tests/api/recommendations-import.test.ts に skipIf(true) の結合テスト scaffold あり。unit-08 完成後（import route 実装後）に有効化するとインポート履歴が集計反映されるか検証できる
- 保留曲の自動解除は performances リポジトリの add/update に組込み済み（calledByMe=true 時・設定 pending.auto_release_on_call 参照）

## from unit-05（セッション画面完成）
- **unit-06（選曲支援画面）**: 共有コンポーネント src/components/session/song-performance-sheet.tsx を再利用。props: sessionId(必須)/mode/performanceId?/initialSong?（渡すと検索UI非表示・選択済み表示）/initialCalledByMe?(既定false)/initialInstrument?(既定SAX)/initialParticipated?/initialFrontInstruments?/open/onOpenChange/onSaved?/onQuickCreated?。「この曲をコール」は initialSong 固定+initialCalledByMe=true+mode=create で開く
- 「次の曲を考える」は /suggest へ遷移（現状 PlaceholderCard。unit-06 が差し替える）
- テスト基盤: vitest projects で node/dom 環境分離済み。dom テストは testing-library + tests/setup/dom.ts の Radix polyfill を使用。SWR 採用
- GET /api/sessions は曲数/isHome を返さないため画面は venues 突合で母店バッジ付与・曲数は非表示（unit-07 以降でAPIに件数追加すれば表示可）
