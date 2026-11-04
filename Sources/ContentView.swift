import SwiftUI

struct ContentView: View {
    @ObservedObject var device: UFOTWController
    @ObservedObject var model: ControlModel
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            Form {
                connectionSection

                Section {
                    Picker("モード", selection: $model.mode) {
                        ForEach(ControlMode.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }

                if model.mode == .manual {
                    manualSection
                } else {
                    patternSection
                }

                outputSection
            }
            .navigationTitle("UFO TW")
            .safeAreaInset(edge: .bottom) { stopButton }
        }
        .onChange(of: scenePhase) { phase in
            // バックグラウンドでは送信できなくなるので、その前に必ず止める
            if phase == .background { model.emergencyStop() }
        }
    }

    // MARK: - 接続

    private var connectionSection: some View {
        Section("接続") {
            HStack {
                Circle().fill(statusColor).frame(width: 10, height: 10)
                Text(statusText)
                Spacer()
                connectButton
            }
            if let error = device.lastError {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
        }
    }

    @ViewBuilder
    private var connectButton: some View {
        switch device.state {
        case .idle:
            Button("探す") { device.startScan() }
        case .scanning, .connecting:
            Button("キャンセル") { model.disconnect() }
        case .connected:
            Button("切断") { model.disconnect() }
        default:
            EmptyView()
        }
    }

    private var statusText: String {
        switch device.state {
        case .bluetoothOff: return "Bluetoothがオフです"
        case .unauthorized: return "Bluetoothが許可されていません（設定アプリで許可）"
        case .unsupported: return "この端末はBLEに対応していません"
        case .idle: return "未接続"
        case .scanning: return "探しています…"
        case .connecting(let name): return "\(name) に接続中…"
        case .connected(let name): return "\(name) に接続済み"
        }
    }

    private var statusColor: Color {
        switch device.state {
        case .connected: return .green
        case .scanning, .connecting: return .orange
        default: return .gray
        }
    }

    // MARK: - 手動

    private var manualSection: some View {
        Section {
            Toggle("左右を連動", isOn: $model.linked)
            speedSlider(title: "左", value: $model.left)
            speedSlider(title: "右", value: $model.right)
                .disabled(model.linked)
            Button("0 に戻す") {
                model.left = 0
                model.right = 0
            }
        } header: {
            Text("手動")
        } footer: {
            Text("中央が停止、右側が正転、左側が逆転です。")
        }
    }

    private func speedSlider(title: String, value: Binding<Double>) -> some View {
        VStack(alignment: .leading) {
            HStack {
                Text(title)
                Spacer()
                Text(speedLabel(Int(value.wrappedValue.rounded())))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            Slider(value: value, in: -99...99, step: 1)
        }
    }

    // MARK: - パターン

    private var patternSection: some View {
        Section("パターン") {
            Picker("種類", selection: $model.pattern) {
                ForEach(MotionPattern.allCases) { Text($0.rawValue).tag($0) }
            }
            VStack(alignment: .leading) {
                HStack {
                    Text("強さ")
                    Spacer()
                    Text("\(Int(model.intensity))").monospacedDigit().foregroundStyle(.secondary)
                }
                Slider(value: $model.intensity, in: 0...99, step: 1)
            }
            VStack(alignment: .leading) {
                HStack {
                    Text("周期")
                    Spacer()
                    Text(String(format: "%.1f 秒", model.period)).monospacedDigit().foregroundStyle(.secondary)
                }
                Slider(value: $model.period, in: 0.5...8, step: 0.1)
            }
            Toggle("右を逆回転にする", isOn: $model.mirror)
            Button(model.isPlaying ? "一時停止" : "再生") { model.togglePlay() }
                .disabled(!device.isConnected)
        }
    }

    // MARK: - 出力

    private var outputSection: some View {
        Section("出力") {
            LabeledContent("左", value: speedLabel(model.outLeft))
            LabeledContent("右", value: speedLabel(model.outRight))
            LabeledContent("送信データ") {
                Text(device.lastPacketHex).font(.system(.body, design: .monospaced))
            }
        }
    }

    private var stopButton: some View {
        Button {
            model.emergencyStop()
        } label: {
            Text("停止")
                .font(.title2.bold())
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
        }
        .buttonStyle(.borderedProminent)
        .tint(.red)
        .padding()
        .background(.bar)
    }

    private func speedLabel(_ value: Int) -> String {
        if value == 0 { return "停止" }
        return "\(value > 0 ? "正転" : "逆転") \(abs(value))"
    }
}
