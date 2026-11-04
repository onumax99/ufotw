# UFOController（Vorze U.F.O. TW 用 iPhone アプリ）

SwiftUI と CoreBluetooth だけで作った、U.F.O. TW をスマホから操作するための最小構成のアプリです。外部ライブラリは使っていません。

## できること

- U.F.O. TW を探して自動で接続（BLE 名が `UFO-` / `UFO ` で始まる機器）
- **手動モード**：左右それぞれの回転速度と向きをスライダーで操作（-99〜99、中央が停止）。左右の連動も可能
- **パターンモード**：一定／ウェーブ／交互反転／パルス／ランダム。強さ・周期・左右逆回転を調整可能
- 画面下の大きな **停止ボタン**
- アプリがバックグラウンドに入ると自動で停止
- 送信中のバイト列を画面に表示（デバッグ用）

## 必要なもの

- Mac と Xcode 14.2 以降（対象は iOS 16 以降の iPhone）。macOS 12 の Mac では Xcode 14.2 が上限で、App Store には出てこないため https://developer.apple.com/download/all/ から `Xcode_14.2.xip` をダウンロードする
- 実機の iPhone（シミュレータは Bluetooth を使えません）
- Apple ID（無料でも実機に入れられますが、7 日ごとに入れ直しが必要。有料の Developer Program なら 1 年間有効）

## セットアップ（GitHub Actions でビルドして Sideloadly で入れる方法・現在の運用）

手元の Mac が古くて Xcode から iPhone に入れられない場合の手順です。Xcode は不要で、Windows でも同じ手順で動きます。

1. GitHub に push すると `.github/workflows/build-ipa.yml` が走り、未署名の IPA ができます（main への push と、Actions 画面の **Run workflow** で実行）
2. GitHub の **Actions** → 該当の実行 → **Artifacts** から `UFOController-unsigned-ipa` をダウンロードして zip を展開し、中の `.ipa` を取り出す
3. https://sideloadly.io/ から Sideloadly を入れる（Mac は公式サイト版、Windows は Apple 公式サイト版の iTunes も必要）
4. iPhone を USB でつなぎ、Sideloadly に `.ipa` をドラッグ → 自分の Apple ID を入れて **Start**
5. 初回は iPhone の「設定 → 一般 → VPN とデバイス管理」で開発元を信頼する

- 無料の Apple ID で署名したアプリは **7 日で起動できなくなる** ので、期限が来たら同じ IPA をもう一度 Sideloadly で入れ直す（データは残る）
- 有料の Apple Developer Program（年 99 ドル）に入ると、同じワークフローから TestFlight に上げて 90 日有効にできる

## セットアップ（Xcode 14.2 以降がある Mac で直接入れる方法）

```sh
# Homebrew が未インストールなら https://brew.sh の手順で先に入れる
brew install xcodegen
cd ~/Documents/github/ufotw
sudo xcode-select -s /Applications/Xcode.app   # コマンドラインツールだけが選ばれている場合
xcodegen
open UFOController.xcodeproj
```

1. Xcode でターゲット **UFOController** → **Signing & Capabilities** → **Team** に自分の Apple ID を選ぶ
2. Bundle Identifier（`jp.oyuki.ufotw`）で「使えない」と出たら、project.yml の `PRODUCT_BUNDLE_IDENTIFIER` を別の名前にして `xcodegen` を再実行
3. iPhone を USB でつないで、実行先に選んで ▶︎ で実行
4. 初回は iPhone の「設定 → 一般 → VPN とデバイス管理」で開発元を信頼する

## セットアップ（XcodeGen を使わない方法）

1. Xcode → New Project → iOS → **App**（Interface: SwiftUI）で `UFOController` を作成
2. 自動で作られた `ContentView.swift` と `〇〇App.swift` を削除し、`Sources/` の 4 ファイルをプロジェクトに追加
3. ターゲット → **Info** に `Privacy - Bluetooth Always Usage Description` を追加（説明文は任意）
4. Xcode 26 でコンパイルエラーが出る場合は、Build Settings の **Default Actor Isolation** を `nonisolated` に変更

## ファイル構成

| ファイル | 役割 |
|---|---|
| `UFOTWController.swift` | BLE のスキャン・接続・送信。パケット生成もここ |
| `ControlModel.swift` | 手動・パターンの値から 20Hz で左右の速度を計算 |
| `ContentView.swift` | 画面 |
| `UFOControllerApp.swift` | エントリーポイント |

## プロトコルのメモ

オープンソースの [buttplug.io](https://github.com/buttplugio/buttplug)（BSD-3-Clause）の実装とテストを参考にしました。Vorze の公式資料ではありません。

- Service UUID：`40EE1111-63EC-4B7F-8CE7-712EFD55B90E`
- 書き込み先 Characteristic：`40EE2222-63EC-4B7F-8CE7-712EFD55B90E`（応答付き書き込み）
- パケット：`[0x05, 左, 右]` の 3 バイト
  - 各バイト = `(正転なら 0x80) | 速度`、速度は 0〜99（0x00〜0x63）
  - 停止：`05 80 80`
  - 左だけ正転 50：`05 B2 80`
  - 左 逆転 99、右 正転 25：`05 63 99`

「正転」は buttplug での `Clockwise = true` に当たる向きです。実際にどちら向きに回るかは実機で確認してください。

## 注意

- 非公式のプロトコルを使うので、本体の仕様が変わると動かなくなる可能性があります。動作は自己責任でお願いします。
- 公式のコントローラーや他のアプリが接続していると、このアプリからは見つからないことがあります。先に切断してください。
- App Store で公開する場合は Apple の審査ガイドラインに従う必要があります。自分の端末で使うだけなら上の手順で足ります。
