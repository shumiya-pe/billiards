# CLAUDE.md — ナインボール（billiards）

shumiya 教育アプリシリーズの一員。**シリーズ共通仕様の正本は bun-hq リポジトリの
`side-business/edu-apps/COMMON.md`**（ローカル：`/Users/mbp/ws/bun-hq/side-business/edu-apps/COMMON.md`）。

作業前に読むもの：
1. 本ファイル
2. `SPEC.md`（このアプリ固有の仕様）
3. 共通仕様の確認が必要なら bun-hq の COMMON.md
4. 実装の参考はリファレンス実装 clock-practice（`/Users/mbp/ws/clock-practice`）

## このアプリの位置づけ

- アプリ名：**ナインボール** — ビリヤードのゲームアプリ（ゲームベース・教育要素はあとから追加する方針）
- クイズ形式・しょうぶモードなど COMMON.md のクイズ系機能仕様は適用外。デザイントーン・技術スタック・バージョン管理・PWA/配信ルールは共通仕様に従う
- ゲーム仕様（物理エンジン・ルール）は `SPEC.md` を正とする

## リポジトリ運用（要点）

- 独立した Git リポジトリとして扱う。コミット・push・status 確認はこのリポジトリ内で行う
- **`main` は統合ブランチ、`release` が本番ブランチ**（2026-09-09〜）。`main` への push は
  Vercel の Preview デプロイまでで、**公開はされない**。公開は `release` への fast-forward 昇格でのみ起きる
- 公開は bun-hq の `/merge-ai <リポジトリ> --publish` で行う。`release` に直接コミットを作らない
- コミットメッセージは英語命令形
- 機能を変えたら `package.json` の version（semver）と `CHANGELOG.md` を必ず更新する
- 一時ファイル・生成物・秘密情報はコミットしない
- シリーズ全体の方針・進捗・ストア展開に関わる変更は bun-hq 側（STATE / README / COMMON.md）への反映を検討する

## 経緯

以前は kids-app-template 由来の共通ルール全文を本ファイルに置いていたが、
2026年7月に正本を bun-hq の COMMON.md へ一本化した。
共通仕様の変更は本ファイルではなく COMMON.md で行うこと。
