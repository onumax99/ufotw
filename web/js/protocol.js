// U.F.O. TW の BLE プロトコル（非公式）。
// 出典: buttplug（BSD-3-Clause）の vorze_sa/dual_rotator.rs と test_vorze_ufo_tw.yaml。
// iPhone 版の Sources/UFOTWController.swift と同じ内容。

export const SERVICE_UUID = '40ee1111-63ec-4b7f-8ce7-712efd55b90e';
export const TX_UUID = '40ee2222-63ec-4b7f-8ce7-712efd55b90e';
export const DEVICE_ID = 0x05;
export const MAX_SPEED = 99;

// "UFO-TW" / "UFO-" / "UFO " で見つかる。"UFOSA"（初代）はプロトコルが違うので対象外。
export const NAME_PREFIXES = ['UFO-', 'UFO '];

/** 速度を -99〜99 の整数にそろえる。正 = 正転（buttplug の Clockwise）、負 = 逆転、0 = 停止 */
export function clamp(speed) {
  const n = Math.round(Number(speed) || 0);
  return Math.max(-MAX_SPEED, Math.min(MAX_SPEED, n)) || 0; // -0 を 0 にする
}

/** 1 バイト = (正転なら 0x80) | 速度 */
export function encode(speed) {
  const s = clamp(speed);
  return (s >= 0 ? 0x80 : 0x00) | Math.abs(s);
}

/** 送信するパケット [0x05, 左, 右] */
export function packet(left, right) {
  return Uint8Array.of(DEVICE_ID, encode(left), encode(right));
}

export function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

export function isUFOTW(name) {
  return typeof name === 'string' && NAME_PREFIXES.some((p) => name.startsWith(p));
}

/** 画面表示用: 「停止」「正転 50」「逆転 30」 */
export function speedLabel(value) {
  const v = clamp(value);
  if (v === 0) return '停止';
  return `${v > 0 ? '正転' : '逆転'} ${Math.abs(v)}`;
}
