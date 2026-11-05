// テスト用の仮想機器。navigator.bluetooth の代わりに UFODevice へ渡す。
// ブラウザでは URL に ?mock を付けると使われる（実機には何も送らない）。
// テスト（test/web/）でも使う。

import { toHex } from './protocol.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {object} [options]
 * @param {number} [options.latencyMs] 1 回の書き込みにかかる時間
 * @param {string} [options.name] 機器の名前
 * @param {boolean} [options.cancel] true なら選択画面でキャンセルされたことにする
 */
export function createMockBluetooth({ latencyMs = 25, name = 'UFO-TW', cancel = false } = {}) {
  /** 書き込まれたパケット（16 進文字列）。接続・切断も 'connect' / 'disconnect' として記録する */
  const log = [];
  let inFlight = false;

  const characteristic = {
    properties: { write: true, writeWithoutResponse: false },
    async writeValueWithResponse(data) {
      // 本物の Web Bluetooth と同じく、送信中にもう 1 件書こうとするとエラーにする
      if (inFlight) throw new Error('GATT operation already in progress.');
      if (!gatt.connected) throw new Error('GATT Server is disconnected.');
      inFlight = true;
      try {
        await sleep(latencyMs);
        log.push(toHex(new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength ?? data.length)));
      } finally {
        inFlight = false;
      }
    },
  };

  const service = {
    async getCharacteristic() {
      return characteristic;
    },
  };

  const device = new EventTarget();
  device.name = name;

  const gatt = {
    connected: false,
    async connect() {
      await sleep(latencyMs);
      gatt.connected = true;
      log.push('connect');
      return { getPrimaryService: async () => service };
    },
    disconnect() {
      if (!gatt.connected) return;
      gatt.connected = false;
      log.push('disconnect');
      device.dispatchEvent(new Event('gattserverdisconnected'));
    },
  };
  device.gatt = gatt;

  const bluetooth = {
    lastOptions: null,
    async requestDevice(options) {
      bluetooth.lastOptions = options;
      await sleep(latencyMs);
      if (cancel) {
        const e = new Error('User cancelled the requestDevice() chooser.');
        e.name = 'NotFoundError';
        throw e;
      }
      return device;
    },
  };

  return {
    bluetooth,
    log,
    /** 機器側から接続が切れたことにする */
    dropConnection() {
      gatt.disconnect();
    },
  };
}
