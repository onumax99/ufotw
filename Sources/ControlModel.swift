import Foundation
import Combine

enum ControlMode: String, CaseIterable, Identifiable {
    case manual = "手動"
    case pattern = "パターン"
    var id: Self { self }
}

enum MotionPattern: String, CaseIterable, Identifiable {
    case constant = "一定"
    case wave = "ウェーブ"
    case alternate = "交互反転"
    case pulse = "パルス"
    case random = "ランダム"
    var id: Self { self }
}

/// 画面の操作内容から、毎周期（20Hz）左右の速度を計算して送るモデル。
final class ControlModel: NSObject, ObservableObject {

    // モード
    @Published var mode: ControlMode = .manual {
        didSet { if mode != oldValue { resetOutputs() } }
    }

    // 手動
    @Published var left: Double = 0 {
        didSet { if linked, right != left { right = left } }
    }
    @Published var right: Double = 0 {
        didSet { if linked, left != right { left = right } }
    }
    @Published var linked = true {
        didSet { if linked { right = left } }
    }

    // パターン
    @Published var pattern: MotionPattern = .wave
    @Published var intensity: Double = 60   // 最大速度 0...99
    @Published var period: Double = 2.0     // 1 周期の秒数
    @Published var mirror = false           // 右を左と逆回転にする
    @Published private(set) var isPlaying = false

    // 実際に送っている値（表示用）
    @Published private(set) var outLeft = 0
    @Published private(set) var outRight = 0

    let device: UFOTWController

    private var timer: Timer?
    private var startDate = Date()
    private var random = RandomState()
    private var cancellables = Set<AnyCancellable>()

    private struct RandomState {
        var left = 0.0, right = 0.0
        var targetLeft = 0.0, targetRight = 0.0
        var nextChange = 0.0
    }

    init(device: UFOTWController) {
        self.device = device
        super.init()

        // 接続・切断のたびに出力をゼロに戻す（つないだ瞬間に動き出さないように）
        device.$state
            .removeDuplicates()
            .sink { [weak self] _ in self?.resetOutputs() }
            .store(in: &cancellables)

        let t = Timer(timeInterval: 0.05, target: self, selector: #selector(tick),
                      userInfo: nil, repeats: true)
        // .common にしておくとスライダー操作中も止まらない
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    // MARK: - 操作

    func togglePlay() {
        isPlaying.toggle()
        startDate = Date()
        random = RandomState()
    }

    /// すべて止める（停止ボタン・バックグラウンド移行時）
    func emergencyStop() {
        resetOutputs()
        device.stopAll()
    }

    func disconnect() {
        resetOutputs()
        device.disconnect()
    }

    private func resetOutputs() {
        isPlaying = false
        left = 0
        right = 0
    }

    // MARK: - 出力計算

    @objc private func tick() {
        let output: (Int, Int)
        switch mode {
        case .manual:
            output = (Int(left.rounded()), Int(right.rounded()))
        case .pattern:
            output = isPlaying ? patternOutput(t: Date().timeIntervalSince(startDate)) : (0, 0)
        }

        if outLeft != output.0 { outLeft = output.0 }
        if outRight != output.1 { outRight = output.1 }
        device.setSpeeds(left: output.0, right: output.1)
    }

    private func patternOutput(t: TimeInterval) -> (Int, Int) {
        let maxValue = intensity
        let p = max(0.3, period)
        let phase = t.truncatingRemainder(dividingBy: p) / p // 0..<1

        let value: Double
        var direction = 1.0

        switch pattern {
        case .constant:
            value = maxValue
        case .wave:
            value = maxValue * (0.5 - 0.5 * cos(2 * .pi * phase)) // 0 → 最大 → 0
        case .alternate:
            value = maxValue
            direction = phase < 0.5 ? 1 : -1
        case .pulse:
            value = phase < 0.5 ? maxValue : 0
        case .random:
            return randomOutput(t: t, maxValue: maxValue, period: p)
        }

        let l = Int((value * direction).rounded())
        return (l, mirror ? -l : l)
    }

    private func randomOutput(t: TimeInterval, maxValue: Double, period: Double) -> (Int, Int) {
        if t >= random.nextChange {
            random.targetLeft = Double.random(in: -maxValue...maxValue)
            random.targetRight = mirror ? -random.targetLeft : Double.random(in: -maxValue...maxValue)
            random.nextChange = t + Double.random(in: 0.5...1.5) * period
        }
        // 急に変わらないよう少しずつ目標値へ近づける
        random.left += (random.targetLeft - random.left) * 0.15
        random.right += (random.targetRight - random.right) * 0.15
        return (Int(random.left.rounded()), Int(random.right.rounded()))
    }
}
