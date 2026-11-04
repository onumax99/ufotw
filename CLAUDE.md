# ufotw — Vorze U.F.O. TW 用 iPhone アプリ

Vorze の U.F.O. TW（左右 2 つの回転部を持つ BLE 機器）を iPhone から操作する個人用アプリ。SwiftUI + CoreBluetooth のみで、外部ライブラリは使っていない。

## 現在の状態

- 2026-11-05 時点で、コマンドラインツールの Swift 5.7.2 + macOS 13.1 SDK（Xcode 14.2 と同世代）で `swiftc -typecheck` が通ることを確認済み。**Xcode での iOS ビルドと実機確認はまだ**。
- 送信するバイト列は buttplug のテストデータと一致することを確認済み（下記「プロトコル」）。
- 実機での動作確認はまだ。特に「正転」が実際にどちら向きかは未確認。
- 開発機は Intel Mac（x86_64）、**macOS 12.7.6**。この macOS に入る Xcode は最大 **14.2**（Swift 5.7 / iOS 16.2 SDK）。そのため deployment target は iOS 16.0 にしてあり、iOS 17 以降専用の API（`onChange(of:) { old, new in }` の 2 引数形式、`@Observable` など）は使わない。
- 開発機には 2026-11-05 時点で Xcode・Homebrew・xcodegen のどれも入っていない（`/Library/Developer/CommandLineTools` のみ）。Xcode 14.2 は App Store には出てこないので https://developer.apple.com/download/all/ から `Xcode_14.2.xip` を取ってくる必要がある。
- 開発機は MacBook Pro 13 インチ 2016（MacBookPro13,2）で、対応する macOS の上限が 12 Monterey。つまり **この Mac では Xcode 14.2 が最終**で、それ以上には上げられない。
- 対象の iPhone は **iOS 27.0.1**（2026-11-05 時点）。Xcode 14.2 からは実機に入れられない（iOS 17 以降は実機接続の仕組みが CoreDevice に変わり、DeviceSupport のコピーでは対応不可）。実機に入れる手段は **GitHub Actions で未署名 IPA をビルドし、この Mac から Sideloadly で署名してインストール** に決定（2026-11-05）。ワークフローは `.github/workflows/build-ipa.yml`、手順は README 参照。App Store 公開は審査（アダルト機器・他社商標）で通る見込みが低いので予定なし。

## ビルド

```sh
brew install xcodegen   # 初回のみ
xcodegen                # project.yml から UFOController.xcodeproj を生成
open UFOController.xcodeproj
```

- `.xcodeproj` は生成物で git 管理外。ビルド設定・Info.plist の項目は **project.yml** に書く（Xcode 上で変えた設定は `xcodegen` 再実行で消える）。
- ファイルを追加・削除したら `xcodegen` を再実行する。
- 署名チームは project.yml の `DEVELOPMENT_TEAM` に入れておくと消えない。
- コマンドラインでの型チェック例: `xcodebuild -scheme UFOController -destination 'generic/platform=iOS' -configuration Debug build CODE_SIGNING_ALLOWED=NO`
- Xcode なしでの簡易チェック（macOS SDK を iOS 16 相当の代わりに使う。UIKit 依存を増やすと使えなくなる）:
  `swiftc -typecheck -sdk "$(xcrun --sdk macosx --show-sdk-path)" -target x86_64-apple-macos13.0 -swift-version 5 Sources/*.swift`
- BLE を使うのでシミュレータでは接続まで試せない。動作確認は実機で。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `Sources/UFOTWController.swift` | BLE のスキャン・接続・送信、パケット生成 |
| `Sources/ControlModel.swift` | 手動／パターンの入力から 20Hz で左右の速度を計算して送る |
| `Sources/ContentView.swift` | 画面（Form ベース） |
| `Sources/UFOControllerApp.swift` | エントリーポイント |
| `.github/workflows/build-ipa.yml` | GitHub Actions で未署名 IPA をビルドして Artifacts に保存 |

## プロトコル（非公式）

出典: buttplug（BSD-3-Clause）の `crates/buttplug_server/src/device/protocol_impl/vorze_sa/dual_rotator.rs` と `crates/buttplug_tests/tests/util/device_test/device_test_case/test_vorze_ufo_tw.yaml`、設定は `device-config/protocols/vorze-sa.yml`。

- BLE 名: `UFO-TW` / `UFO-` / `UFO `（`UFOSA` は初代でプロトコルが違うので対象外）
- Service: `40EE1111-63EC-4B7F-8CE7-712EFD55B90E`
- TX Characteristic: `40EE2222-63EC-4B7F-8CE7-712EFD55B90E`（応答付き書き込み）
- パケット: `[0x05, 左, 右]`
  - 各バイト = `(Clockwise なら 0x80) | 速度`、速度 0〜99
  - テストデータの例: 停止 `05 80 80` / 左 CW 50 `05 B2 80` / 左 CCW 99 `05 63 80` / 左 CCW 99・右 CW 25 `05 63 99`
- 左右は 1 パケットでまとめて送るので、片側だけ変える場合も両方の値を送る。

## 設計上の決まり

- 速度は -99〜99 の Int で扱う。正 = 正転（buttplug の Clockwise=true）、負 = 逆転、0 = 停止。
- 送信は応答付き書き込みを常に 1 件だけ送信中にし、送るのは最新の値だけ（`didWriteValueFor` で次を送る）。同じ値は送らない。
- `ControlModel` の Timer は 0.05 秒間隔で `RunLoop.main` の `.common` モードに登録（スライダー操作中も止まらないように）。
- 安全のため、接続・切断のたびに出力をゼロに戻し、接続直後に停止パケットを送る。アプリがバックグラウンドに入ったら停止する。切断時は停止を送ってから 0.3 秒後に切断する。
- 並行性チェックで揉めないよう、遅延実行は `perform(_:with:afterDelay:)`、Timer はセレクタ方式にしている。Swift 5 モード。
- UI の文言は日本語。

## 追加機能の候補（未決定）

ユーザーとまだ決めていない。実装前に確認すること。

- 動画・音楽に合わせて動かす
- 離れた場所から操作する
- 自分でパターンを作って保存する
