import Foundation
import CoreBluetooth

/// Vorze U.F.O. TW を Bluetooth LE で制御するクラス。
///
/// プロトコルはオープンソースの buttplug.io（BSD-3-Clause）の実装とテストを参照:
///   - Service : 40EE1111-63EC-4B7F-8CE7-712EFD55B90E
///   - TX      : 40EE2222-63EC-4B7F-8CE7-712EFD55B90E（応答付き書き込み）
///   - パケット: [0x05, 左, 右] の 3 バイト
///     各バイト = (正転なら 0x80) | 速度(0...99)
///     例) 停止 = 05 80 80 / 左だけ正転50 = 05 B2 80
///
/// 速度は -99...99 で扱い、正の値が「正転」（buttplug の Clockwise=true）、負の値が「逆転」。
final class UFOTWController: NSObject, ObservableObject {

    enum ConnectionState: Equatable {
        case bluetoothOff
        case unauthorized
        case unsupported
        case idle
        case scanning
        case connecting(String)
        case connected(String)
    }

    static let serviceUUID = CBUUID(string: "40EE1111-63EC-4B7F-8CE7-712EFD55B90E")
    static let txUUID = CBUUID(string: "40EE2222-63EC-4B7F-8CE7-712EFD55B90E")
    static let deviceID: UInt8 = 0x05
    static let maxSpeed = 99

    @Published private(set) var state: ConnectionState = .idle
    @Published private(set) var lastPacketHex: String = "-"
    @Published private(set) var lastError: String?

    var isConnected: Bool {
        if case .connected = state { return true }
        return false
    }

    private var central: CBCentralManager!
    private var peripheral: CBPeripheral?
    private var tx: CBCharacteristic?
    private var wantsScan = false
    private var isClosing = false

    // 送信制御: 応答付き書き込みは常に 1 件だけ送信中にし、送るのは最新の値だけ。
    private var target: (left: Int, right: Int) = (0, 0)
    private var lastSent: (left: Int, right: Int)?
    private var writeInFlight = false

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: nil) // コールバックはメインスレッド
    }

    // MARK: - 公開 API

    /// U.F.O. TW を探して、見つかったら自動で接続する。
    func startScan() {
        wantsScan = true
        guard central.state == .poweredOn else { return }
        lastError = nil
        state = .scanning
        central.scanForPeripherals(withServices: nil, options: nil)
        cancelScanTimeout()
        perform(#selector(scanTimedOut), with: nil, afterDelay: 15)
    }

    /// 停止コマンドを送ってから切断する（スキャン中ならスキャンを止める）。
    func disconnect() {
        wantsScan = false
        switch state {
        case .scanning:
            cancelScanTimeout()
            central.stopScan()
            state = .idle
        case .connected:
            setSpeeds(left: 0, right: 0)
            isClosing = true
            // 停止コマンドが届く時間を少し待ってから切断
            perform(#selector(finishDisconnect), with: nil, afterDelay: 0.3)
        case .connecting:
            finishDisconnect()
        default:
            break
        }
    }

    /// 左右の速度を設定する。-99...99（正 = 正転、負 = 逆転、0 = 停止）
    func setSpeeds(left: Int, right: Int) {
        guard !isClosing else { return }
        target = (Self.clamp(left), Self.clamp(right))
        flush()
    }

    func stopAll() {
        setSpeeds(left: 0, right: 0)
    }

    // MARK: - パケット生成

    static func clamp(_ speed: Int) -> Int {
        max(-maxSpeed, min(maxSpeed, speed))
    }

    static func encode(_ speed: Int) -> UInt8 {
        let s = clamp(speed)
        let direction: UInt8 = s >= 0 ? 0x80 : 0x00
        return direction | UInt8(abs(s))
    }

    static func packet(left: Int, right: Int) -> [UInt8] {
        [deviceID, encode(left), encode(right)]
    }

    static func isUFOTW(name: String) -> Bool {
        // buttplug の設定では "UFO-TW" / "UFO-" / "UFO " の名前で見つかる。
        // "UFOSA"（初代 U.F.O. SA）はプロトコルが違うので除外される。
        name.hasPrefix("UFO-") || name.hasPrefix("UFO ")
    }

    // MARK: - 内部処理

    private func flush() {
        guard isConnected, let p = peripheral, let c = tx else { return }
        if let last = lastSent, last == target { return }

        let withResponse = c.properties.contains(.write)
        if withResponse {
            guard !writeInFlight else { return } // 応答が来たら didWriteValueFor から再送
            writeInFlight = true
        } else {
            guard p.canSendWriteWithoutResponse else { return }
        }

        let bytes = Self.packet(left: target.left, right: target.right)
        p.writeValue(Data(bytes), for: c, type: withResponse ? .withResponse : .withoutResponse)
        lastSent = target
        lastPacketHex = bytes.map { String(format: "%02X", $0) }.joined(separator: " ")
    }

    @objc private func scanTimedOut() {
        guard case .scanning = state else { return }
        central.stopScan()
        wantsScan = false
        state = .idle
        lastError = "見つかりませんでした。本体をクレードルから外して電源が入っているか、他のアプリと接続中でないか確認してください。"
    }

    private func cancelScanTimeout() {
        NSObject.cancelPreviousPerformRequests(withTarget: self, selector: #selector(scanTimedOut), object: nil)
    }

    @objc private func finishDisconnect() {
        if let p = peripheral {
            central.cancelPeripheralConnection(p)
        }
        resetConnection()
        state = central.state == .poweredOn ? .idle : .bluetoothOff
    }

    private func resetConnection() {
        peripheral = nil
        tx = nil
        writeInFlight = false
        lastSent = nil
        isClosing = false
        target = (0, 0)
    }
}

// MARK: - CBCentralManagerDelegate

extension UFOTWController: CBCentralManagerDelegate {

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            state = .idle
            if wantsScan { startScan() }
        case .poweredOff:
            resetConnection()
            state = .bluetoothOff
        case .unauthorized:
            state = .unauthorized
        case .unsupported:
            state = .unsupported
        default:
            state = .idle
        }
    }

    func centralManager(_ central: CBCentralManager,
                        didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any],
                        rssi RSSI: NSNumber) {
        let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String)
            ?? peripheral.name
            ?? ""
        guard Self.isUFOTW(name: name) else { return }

        cancelScanTimeout()
        central.stopScan()
        wantsScan = false
        self.peripheral = peripheral
        peripheral.delegate = self
        state = .connecting(name)
        central.connect(peripheral, options: nil)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices([Self.serviceUUID])
    }

    func centralManager(_ central: CBCentralManager,
                        didFailToConnect peripheral: CBPeripheral,
                        error: Error?) {
        lastError = "接続に失敗しました: \(error?.localizedDescription ?? "不明なエラー")"
        resetConnection()
        state = .idle
    }

    func centralManager(_ central: CBCentralManager,
                        didDisconnectPeripheral peripheral: CBPeripheral,
                        error: Error?) {
        if let error {
            lastError = "切断されました: \(error.localizedDescription)"
        }
        resetConnection()
        state = central.state == .poweredOn ? .idle : .bluetoothOff
    }
}

// MARK: - CBPeripheralDelegate

extension UFOTWController: CBPeripheralDelegate {

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let service = peripheral.services?.first(where: { $0.uuid == Self.serviceUUID }) else {
            lastError = "制御用のサービスが見つかりません"
            central.cancelPeripheralConnection(peripheral)
            return
        }
        peripheral.discoverCharacteristics([Self.txUUID], for: service)
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didDiscoverCharacteristicsFor service: CBService,
                    error: Error?) {
        guard let characteristic = service.characteristics?.first(where: { $0.uuid == Self.txUUID }) else {
            lastError = "制御用のキャラクタリスティックが見つかりません"
            central.cancelPeripheralConnection(peripheral)
            return
        }
        tx = characteristic
        lastSent = nil
        writeInFlight = false
        state = .connected(peripheral.name ?? "U.F.O. TW")
        stopAll() // 接続直後は必ず停止状態を送る
    }

    func peripheral(_ peripheral: CBPeripheral,
                    didWriteValueFor characteristic: CBCharacteristic,
                    error: Error?) {
        writeInFlight = false
        if let error {
            lastError = "送信エラー: \(error.localizedDescription)"
            lastSent = nil // 次のタイマー周期で再送される
            return
        }
        flush() // 送信中に新しい値が来ていれば続けて送る
    }

    func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
        flush()
    }
}
