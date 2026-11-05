// Web Bluetooth で U.F.O. TW に接続して速度を送る。
// iPhone では Safari が Web Bluetooth に対応していないので Bluefy で開く。PC は Chrome / Edge。
//
// 送信のきまり（iPhone 版と同じ）:
//   - 書き込みは常に 1 件だけ送信中にし、送るのは最新の値だけ。同じ値は送らない。
//   - 接続直後に停止パケットを送る。切断するときは停止を送り終えてから切る。

import { SERVICE_UUID, TX_UUID, NAME_PREFIXES, clamp, packet, toHex, isUFOTW } from './protocol.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const UNSUPPORTED_TEXT =
  'このブラウザは Bluetooth に対応していません。iPhone では Bluefy、PC では Chrome か Edge で開いてください。';

/**
 * state:
 *   'unsupported' ブラウザが Web Bluetooth 非対応
 *   'idle'        未接続
 *   'selecting'   機器の選択画面を表示中
 *   'connecting'  接続中
 *   'connected'   接続済み
 *
 * イベント:
 *   'statechange' 接続状態が変わった
 *   'change'      表示に関わる値（送信データ・メッセージなど）が変わった
 */
export class UFODevice extends EventTarget {
  constructor(bluetooth = globalThis.navigator?.bluetooth) {
    super();
    this.bluetooth = bluetooth;
    this.state = bluetooth ? 'idle' : 'unsupported';
    this.name = '';
    this.lastPacketHex = '-';
    /** @type {{ text: string, level: 'error' | 'info' } | null} */
    this.message = null;

    this._device = null;
    this._char = null;
    this._withResponse = true;
    this._target = [0, 0];
    this._lastSent = null;
    this._inFlight = false;
    this._closing = false;
    this._sendError = false;
    this._onDisconnected = () => this._handleUnexpectedDisconnect();
  }

  get isConnected() {
    return this.state === 'connected';
  }

  /**
   * 機器を選んで接続する。ボタンのクリックなど、ユーザー操作の中から呼ぶこと（Web Bluetooth の制約）。
   * showAll: 名前で絞らず、制御用サービスを持つ機器をすべて一覧に出す（名前で見つからないとき用）。
   */
  async connect({ showAll = false } = {}) {
    if (!this.bluetooth) {
      this._setMessage(UNSUPPORTED_TEXT, 'error');
      return;
    }
    if (this.state !== 'idle') return;

    this._setMessage(null);
    this._setState('selecting');

    let device;
    try {
      device = await this.bluetooth.requestDevice(
        showAll
          ? { filters: [{ services: [SERVICE_UUID] }] }
          : { filters: NAME_PREFIXES.map((namePrefix) => ({ namePrefix })), optionalServices: [SERVICE_UUID] },
      );
    } catch (e) {
      this._setState('idle');
      if (e?.name === 'NotFoundError') {
        this._setMessage('機器の選択をキャンセルしました。', 'info');
      } else {
        this._setMessage(`機器を選べませんでした: ${errorText(e)}`, 'error');
      }
      return;
    }

    // 名前で絞っていない一覧から選んだときは、U.F.O. TW 以外（初代 UFOSA など）を断る
    const name = device.name ?? '';
    if (showAll ? !isUFOTW(name) : name !== '' && !isUFOTW(name)) {
      this._setState('idle');
      this._setMessage(`「${name || '名前なし'}」は U.F.O. TW ではないので接続しません。`, 'error');
      return;
    }

    this._device = device;
    this.name = name || 'U.F.O. TW';
    device.addEventListener('gattserverdisconnected', this._onDisconnected);
    this._setState('connecting');

    // 接続中にキャンセルされたら、遅れてつながった接続も切る
    const cancelled = () => {
      if (this._device === device) return false;
      device.gatt?.disconnect();
      return true;
    };

    try {
      const server = await device.gatt.connect();
      if (cancelled()) return;
      const service = await server.getPrimaryService(SERVICE_UUID);
      const characteristic = await service.getCharacteristic(TX_UUID);
      if (cancelled()) return;

      const props = characteristic.properties;
      this._withResponse = props ? Boolean(props.write || !props.writeWithoutResponse) : true;
      this._char = characteristic;
      this._resetSendState();
      this._setState('connected');
      this.stopAll(); // 接続直後は必ず停止状態を送る
    } catch (e) {
      if (cancelled()) return;
      this._teardown();
      this._setMessage(`接続に失敗しました: ${errorText(e)}`, 'error');
    }
  }

  /** 停止を送ってから切断する。接続中ならそのまま中断する。 */
  async disconnect() {
    if (this.state === 'connecting') {
      this._teardown();
      return;
    }
    if (this.state !== 'connected' || this._closing) return;

    this.setSpeeds(0, 0);
    this._closing = true; // これ以降の setSpeeds は無視
    await this._waitUntilSent(1000);
    this._teardown();
  }

  /** 左右の速度を設定する。-99〜99（正 = 正転、負 = 逆転、0 = 停止） */
  setSpeeds(left, right) {
    if (this._closing) return;
    this._target = [clamp(left), clamp(right)];
    this._flush();
  }

  stopAll() {
    this.setSpeeds(0, 0);
  }

  // ---- 内部処理 ----

  _flush() {
    if (this.state !== 'connected' || !this._char || this._inFlight) return;
    const [left, right] = this._target;
    if (this._lastSent && this._lastSent[0] === left && this._lastSent[1] === right) return;

    const characteristic = this._char;
    const bytes = packet(left, right);
    this._inFlight = true;
    this._lastSent = [left, right];
    this.lastPacketHex = toHex(bytes);
    this._emit();

    const write = this._withResponse
      ? characteristic.writeValueWithResponse ?? characteristic.writeValue
      : characteristic.writeValueWithoutResponse ?? characteristic.writeValue;

    Promise.resolve()
      .then(() => write.call(characteristic, bytes))
      .then(
        () => {
          if (characteristic !== this._char) return; // 切断済み
          this._inFlight = false;
          if (this._sendError) {
            this._sendError = false;
            this._setMessage(null);
          }
          this._flush(); // 送信中に新しい値が来ていれば続けて送る
        },
        (e) => {
          if (characteristic !== this._char) return;
          this._inFlight = false;
          this._lastSent = null; // 次の周期（setSpeeds）で再送される
          this._sendError = true;
          this._setMessage(`送信エラー: ${errorText(e)}`, 'error');
        },
      );
  }

  async _waitUntilSent(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const [left, right] = this._target;
      const sent = this._lastSent && this._lastSent[0] === left && this._lastSent[1] === right;
      if (sent && !this._inFlight) return true;
      this._flush(); // 送信エラーで止まっていたら再送する
      await sleep(20);
    }
    return false;
  }

  _handleUnexpectedDisconnect() {
    if (!this._device) return;
    this._teardown({ alreadyDisconnected: true });
    this._setMessage('接続が切れました。', 'error');
  }

  _teardown({ alreadyDisconnected = false } = {}) {
    const device = this._device;
    this._device = null;
    this._char = null;
    this._resetSendState();
    this.name = '';
    if (device) {
      device.removeEventListener('gattserverdisconnected', this._onDisconnected);
      // 接続処理の途中でも切れるよう、connected を見ずに呼ぶ（未接続なら何もしない）
      if (!alreadyDisconnected) device.gatt?.disconnect();
    }
    this._setState('idle');
  }

  _resetSendState() {
    this._target = [0, 0];
    this._lastSent = null;
    this._inFlight = false;
    this._closing = false;
    this._sendError = false;
  }

  _setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
    this._emit();
  }

  _setMessage(text, level = 'info') {
    this.message = text ? { text, level } : null;
    this._emit();
  }

  _emit() {
    this.dispatchEvent(new Event('change'));
  }
}

function errorText(e) {
  return e?.message || String(e);
}
