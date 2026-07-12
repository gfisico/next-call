# 後続ユニットへの申し送り

## from unit-02 レビュー（low・非ブロッキング）
- **unit-07（設定画面）**: EngineConfig.longUnplunplayedDays（365）は実装未使用（理由閾値は m_old≥0.5 で判定、既定値では等価）。設定画面でこのキーを公開する場合は実装との接続を確認すること
- **unit-04（推薦API）**: genreCallRatios に無いジャンルは低頻度減点がスキップされる（安全側）。EngineInput 組み立て時に全ジャンルの比率を渡すこと

## from unit-01 レビュー（low・非ブロッキング）
- **unit-05/06/07（画面）**: testing-library 未導入。画面テストで導入が必要
- **Toast**: sonner の Toaster がレイアウト未マウント。Toast を使う最初の画面ユニットでマウントすること
