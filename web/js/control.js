// 画面の操作内容から、毎周期（20Hz）左右の速度を計算して送る。
// iPhone 版の Sources/ControlModel.swift と同じ動き。

import { clamp } from './protocol.js';

export const TICK_MS = 50;

export const PATTERNS = [
  ['constant', '一定'],
  ['wave', 'ウェーブ'],
  ['alternate', '交互反転'],
  ['pulse', 'パルス'],
  ['random', 'ランダム'],
];

/**
 * ランダム以外のパターンの出力。t は再生開始からの秒数。
 * @returns {[number, number]} [左, 右]
 */
export function patternOutput(pattern, t, { intensity, period, mirror }) {
  const max = intensity;
  const p = Math.max(0.3, period);
  const phase = (t % p) / p; // 0〜1

  let value;
  let direction = 1;
  switch (pattern) {
    case 'constant':
      value = max;
      break;
    case 'wave':
      value = max * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase)); // 0 → 最大 → 0
      break;
    case 'alternate':
      value = max;
      direction = phase < 0.5 ? 1 : -1;
      break;
    case 'pulse':
      value = phase < 0.5 ? max : 0;
      break;
    default:
      value = 0;
  }
  const left = clamp(value * direction);
  return [left, mirror ? clamp(-left) : left];
}

/** ランダムパターン。目標値を時々選び直し、急に変わらないよう少しずつ近づける。 */
export class RandomWalk {
  constructor(random = Math.random) {
    this.random = random;
    this.left = 0;
    this.right = 0;
    this.targetLeft = 0;
    this.targetRight = 0;
    this.nextChange = 0;
  }

  next(t, { intensity, period, mirror }) {
    const p = Math.max(0.3, period);
    const between = (lo, hi) => lo + (hi - lo) * this.random();
    if (t >= this.nextChange) {
      this.targetLeft = between(-intensity, intensity);
      this.targetRight = mirror ? -this.targetLeft : between(-intensity, intensity);
      this.nextChange = t + between(0.5, 1.5) * p;
    }
    this.left += (this.targetLeft - this.left) * 0.15;
    this.right += (this.targetRight - this.right) * 0.15;
    return [clamp(this.left), clamp(this.right)];
  }
}

/**
 * イベント:
 *   'change' 設定が変わった（画面の入力欄を更新する）
 *   'output' 実際に送る値（outLeft / outRight）が変わった
 */
export class ControlModel extends EventTarget {
  constructor(device, { now = () => performance.now() / 1000, random = Math.random } = {}) {
    super();
    this.device = device;
    this.now = now;
    this.random = random;

    this.mode = 'manual';
    // 手動
    this.left = 0;
    this.right = 0;
    this.linked = true;
    // パターン
    this.pattern = 'wave';
    this.intensity = 60; // 最大速度 0〜99
    this.period = 2.0; // 1 周期の秒数
    this.mirror = false; // 右を左と逆回転にする
    this.playing = false;
    // 音声同期
    this.syncOffset = 0; // 秒。正 = CSV の動きを早める、負 = 遅らせる
    this._syncSource = null; // () => [左, 右]。再生中の音声と CSV から今の値を返す（app.js が設定）
    // 実際に送っている値（表示用）
    this.outLeft = 0;
    this.outRight = 0;

    this._startTime = 0;
    this._walk = new RandomWalk(random);
    this._timer = null;

    // 接続・切断のたびに出力をゼロに戻す（つないだ瞬間に動き出さないように）
    device.addEventListener('statechange', () => this.resetOutputs());
  }

  start() {
    if (this._timer === null) this._timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  // ---- 操作 ----

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.resetOutputs();
  }

  setLeft(value) {
    this.left = clamp(value);
    if (this.linked) this.right = this.left;
    this._changed();
  }

  setRight(value) {
    this.right = clamp(value);
    if (this.linked) this.left = this.right;
    this._changed();
  }

  setLinked(linked) {
    this.linked = Boolean(linked);
    if (this.linked) this.right = this.left;
    this._changed();
  }

  zero() {
    this.left = 0;
    this.right = 0;
    this._changed();
  }

  setPattern(pattern) {
    this.pattern = pattern;
    this._changed();
  }

  setIntensity(value) {
    this.intensity = Math.max(0, Math.min(99, Math.round(Number(value) || 0)));
    this._changed();
  }

  setPeriod(value) {
    this.period = Math.max(0.5, Math.min(8, Number(value) || 0.5));
    this._changed();
  }

  setMirror(mirror) {
    this.mirror = Boolean(mirror);
    this._changed();
  }

  /** 音声同期モードで使う値の取り出し口。音声が止まっているときは [0, 0] を返すこと */
  setSyncSource(source) {
    this._syncSource = source;
  }

  setSyncOffset(seconds) {
    const value = Math.round((Number(seconds) || 0) * 100) / 100;
    this.syncOffset = Math.max(-1, Math.min(1, value));
    this._changed();
  }

  togglePlay() {
    this.playing = !this.playing;
    this._startTime = this.now();
    this._walk = new RandomWalk(this.random);
    this._changed();
  }

  /** すべて止める（停止ボタン・画面が隠れたとき） */
  emergencyStop() {
    this.resetOutputs();
    this.device.stopAll();
  }

  disconnect() {
    this.resetOutputs();
    return this.device.disconnect();
  }

  resetOutputs() {
    this.playing = false;
    this.left = 0;
    this.right = 0;
    this._changed();
  }

  // ---- 出力計算 ----

  tick() {
    let output;
    if (this.mode === 'manual') {
      output = [this.left, this.right];
    } else if (this.mode === 'sync') {
      const value = this._syncSource ? this._syncSource() : null;
      output = value ? [clamp(value[0]), clamp(value[1])] : [0, 0];
    } else if (!this.playing) {
      output = [0, 0];
    } else {
      const t = this.now() - this._startTime;
      const settings = { intensity: this.intensity, period: this.period, mirror: this.mirror };
      output = this.pattern === 'random' ? this._walk.next(t, settings) : patternOutput(this.pattern, t, settings);
    }

    const [left, right] = output;
    if (left !== this.outLeft || right !== this.outRight) {
      this.outLeft = left;
      this.outRight = right;
      this.dispatchEvent(new Event('output'));
    }
    this.device.setSpeeds(left, right);
  }

  _changed() {
    this.dispatchEvent(new Event('change'));
  }
}
