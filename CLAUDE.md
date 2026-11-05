# ufotw — Vorze U.F.O. TW 操作アプリ（Web 版と iPhone アプリ版）

Vorze の U.F.O. TW（左右 2 つの回転部を持つ BLE 機器）をスマホから操作する個人用アプリ。外部ライブラリは使っていない。

- **Web 版**（`web/`）: 素の HTML / CSS / JavaScript（ES modules、ビルド工程なし）+ Web Bluetooth。iPhone では **Bluefy** で開く前提（Safari は Web Bluetooth 非対応で、Apple も対応予定なし）。PC は Chrome / Edge。GitHub Pages（https://onumax99.github.io/ufotw/ ）で公開。**まずはこちらを Bluefy 前提で進める**（2026-11-05 のユーザーの方針。無料 Apple ID の 7 日ごとの入れ直しは許容済み）。
- **iPhone アプリ版**（`Sources/`）: SwiftUI + CoreBluetooth。
- 必要になったら、Bluefy の代わりに自前のアプリ（WKWebView で Web 版を表示し、CoreBluetooth への橋渡しをする）を作る予定。まだ着手していない。

## Web 版の現在の状態と開発

- 2026-11-05 に作成。手動・パターン・停止・送信データ表示は iPhone アプリ版と同じ。
- 同日、**実機（iPhone の Bluefy + U.F.O. TW）で動作に問題がないことをユーザーが確認済み**。ただし「正転」が実際にどちら向きか、アプリ切り替え時に本体が止まるか、画面ロック防止が Bluefy で効くかは、個別には聞いていない。
- 同日、**音声同期モード**（Web 版のみ）を追加。音声・動画と U.F.O. TW 用の連動 CSV を選ぶと、`<audio>` / `<video>` の `currentTime` を時計にして CSV を引き、20Hz の周期で送る。PC の仮想機器とテストでは確認済みで、**実機での確認はまだ**。
  - CSV 形式: 1 行 = `時刻,左の向き,左の速度,右の向き,右の速度`。時刻は 0.1 秒単位、向き 1 = 正転（送信バイトの 0x80）、速度 0〜100（99 に丸める）。その時刻から次の行まで同じ値。3 列（初代 SA 用）は非対応でエラーにする。リンク先の Web CSV Player も時刻を `currentTime * 10` で照合しており、単位はこれで合っている。
  - ユーザーが持っている CSV・音声は市販作品なので、**リポジトリ（Public）には絶対に入れない**。テストの CSV は自作のものを使う。コミットメッセージにも作品名を書かない。
  - 安全のため、停止ボタン・Esc・画面が隠れたとき・接続／切断・モード切り替え・ファイルの選び直しでは、音声も一時停止する（音声だけ進んで途中から動き出さないように）。
- GitHub Pages は 2026-11-05 に有効化済み（Source: GitHub Actions）。同日 https://onumax99.github.io/ufotw/ に公開し、公開版でも `?mock` で接続・送信・停止が動くことを確認した。
- `web/` か `test/web/` を変えて main に push すると `.github/workflows/deploy-web.yml` がテスト → 公開する。
- 手元での確認: `.claude/launch.json` の `web`（`python -m http.server 8123 --bind 127.0.0.1 --directory web`）を起動し、http://localhost:8123/?mock を開く。`?mock` で仮想機器（`web/js/mock.js`）につながり、`window.ufoMock.log` に送ったパケットが残る。`window.ufo` で `device` / `model` を触れる。
- テスト: `node --test test/web/*.test.mjs`。パケットは buttplug のテストデータと照合している。
- iPhone の Bluefy は WebKit なので、Chrome だけの API や新しすぎる CSS は使わない。

## iPhone アプリ版の現在の状態

- **開発環境は Windows PC**（2026-11-05 に移行）。手元に Xcode も Swift コンパイラもないので、**ビルドはすべて GitHub Actions で行う**。コンパイルエラーは push して Actions の結果を見るまで分からない。
- リポジトリは https://github.com/onumax99/ufotw （Public）。Public なので macOS ランナーの利用に上限はない。
- 2026-11-05 時点で GitHub Actions（macos-latest）での iOS ビルドが成功し、未署名 IPA が Artifacts に出ることを確認済み（ビルド #1）。**実機確認はまだ**。
- 送信するバイト列は buttplug のテストデータと一致することを確認済み（下記「プロトコル」）。
- 実機での動作確認はまだ。特に「正転」が実際にどちら向きかは未確認。
- 対象の iPhone は **iOS 27.0.1**（2026-11-05 時点）。実機に入れる手段は **GitHub Actions で未署名 IPA をビルドし、Windows の Sideloadly で署名してインストール** に決定。手順は README 参照。App Store 公開は審査（アダルト機器・他社商標）で通る見込みが低いので予定なし。
- deployment target は iOS 16.0。iOS 17 以降専用の API（`onChange(of:) { old, new in }` の 2 引数形式、`@Observable` など）は使わない。Swift 5 モード。
- 以前の開発機だった MacBook Pro 2016（macOS 12.7.6、Xcode 14.2 が上限、iOS 27 の実機には入れられない）はもう使わない。Mac で作業する場合の手順は README の末尾に残してある。

## iPhone アプリ版のビルドと動作確認（Windows）

1. `Sources/` を編集して main に push する（または Actions 画面の **Run workflow**）。`.github/workflows/build-ipa.yml` が走る（`Sources/`・`project.yml`・ワークフロー自体が変わったときだけ）。
2. https://github.com/onumax99/ufotw/actions で結果を見る。失敗したらジョブのログ（サインインが必要）の「署名なしでビルド」ステップにコンパイルエラーが出る。
3. 成功したら Artifacts の `UFOController-unsigned-ipa`（zip）を取り、中の `.ipa` を Sideloadly で iPhone に入れる。

- GitHub CLI（`gh`）が入っていて、onumax99 でログイン済み（2026-11-05）。Actions の結果やエラーは `gh run list` / `gh run view <id> --log-failed` で読める。再実行は `gh run rerun <id> --failed`、公開の手動実行は `gh workflow run deploy-web.yml`。
  - Claude Code の Bash で `gh` が見つからないときは `"/c/Program Files/GitHub CLI/gh"` をフルパスで使う（インストール直後のセッションでは PATH に入っていないことがある）。
  - `gh` が使えないときは、公開 API で成否だけ取れる: `curl -s https://api.github.com/repos/onumax99/ufotw/actions/runs?per_page=3`。
- 1 回のビルドは 1 分弱。細かく push して確かめてよい。
- `.xcodeproj` は CI 上で project.yml から生成するので git 管理外。ビルド設定・Info.plist の項目は **project.yml** に書く。
- ファイルを追加・削除しても `sources: - Sources` でディレクトリごと拾うので、project.yml の変更は不要。
- Swift ファイルは LF 改行で保存する（`.gitattributes` で強制済み）。文字コードは UTF-8。
- BLE を使うのでシミュレータでは接続まで試せない。動作確認は実機で。
- iPhone のログを Windows で見たいときは iMazing か 3uTools、または libimobiledevice の `idevicesyslog`。まずはアプリ画面の「送信データ」欄で足りるはず。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `web/index.html`・`web/style.css` | Web 版の画面 |
| `web/js/protocol.js` | パケット生成・UUID・名前判定（`UFOTWController.swift` の静的メソッド相当） |
| `web/js/device.js` | Web Bluetooth での接続・送信（`UFOTWController.swift` 相当） |
| `web/js/control.js` | 20Hz で左右の速度を計算（`ControlModel.swift` 相当。音声同期モードは Web 版だけ） |
| `web/js/csv.js` | 連動 CSV の読み込み・再生位置からの引き当て |
| `web/js/app.js` | 画面のつなぎ込み、音声・CSV の読み込み、画面が隠れたら停止、画面ロック防止 |
| `web/js/mock.js` | テスト用の仮想機器 |
| `test/web/*.test.mjs` | Web 版のテスト（Node.js 組み込みの `node:test`） |
| `.github/workflows/deploy-web.yml` | Web 版をテストして GitHub Pages に公開 |
| `.claude/launch.json` | ブラウザ確認用のローカルサーバー |
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
- Web 版も上の送信ルール・安全のルールは同じ。違いは次のとおり。
  - 機器の選択は Web Bluetooth の選択画面で行う（`requestDevice` はボタン操作の中からしか呼べない）。通常は名前（`UFO-` / `UFO `）で絞り、「すべての機器から選ぶ」ではサービス UUID で絞って名前を後から確かめる。
  - バックグラウンドの代わりに `visibilitychange`（hidden）と `pagehide` で停止する。
  - 切断は 0.3 秒固定ではなく、停止パケットの書き込み完了を待って（最大 1 秒）から切る。
  - 対応ブラウザでは接続中に Screen Wake Lock を取り、自動ロックで止まらないようにする。
- 送信ルールや計算を変えるときは、Web 版と iPhone アプリ版の両方をそろえる（片方だけ変えるならその旨を書いておく）。

## 追加機能の候補（未決定）

ユーザーとまだ決めていない。実装前に確認すること。（「動画・音楽に合わせて動かす」は 2026-11-05 に Web 版の音声同期モードとして実装済み）

- 音声同期で、前回選んだ音声と CSV の組み合わせを覚えておく
- 離れた場所から操作する
- 自分でパターンを作って保存する
- Bluefy 相当の自前アプリ（上記。必要になったら）
