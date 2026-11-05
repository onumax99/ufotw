// U.F.O. TW 用の連動 CSV を読み、再生位置ごとの左右の速度を返す。
//
// 1 行 = 時刻,左の向き,左の速度,右の向き,右の速度
//   時刻: 0.1 秒単位（1752 = 175.2 秒）
//   向き: 1 = 正転（送信バイトの 0x80）、0 = 逆転
//   速度: 0〜100（本体の上限 99 に丸める）
// その時刻から次の行の時刻まで、同じ速度を保つ。

import { clamp } from './protocol.js';

/**
 * @returns {{ events: { t: number, left: number, right: number }[], skipped: number }}
 *   events は時刻順。skipped は読めずに飛ばした行の数（見出し行など）。
 */
export function parseVorzeCsv(text) {
  const events = [];
  let skipped = 0;

  for (const raw of String(text).replace(/^﻿/, '').split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (line === '') continue;
    const cols = line.split(',').map((s) => s.trim());
    const nums = cols.slice(0, 5).map((s) => (s === '' ? NaN : Number(s)));
    if (nums.length < 5 || nums.some((n) => !Number.isFinite(n)) || nums[0] < 0) {
      skipped++;
      continue;
    }
    const [time, leftDir, leftSpeed, rightDir, rightSpeed] = nums;
    events.push({ t: time / 10, left: speed(leftDir, leftSpeed), right: speed(rightDir, rightSpeed) });
  }

  if (events.length === 0) {
    throw new Error(
      'U.F.O. TW 用の CSV として読めませんでした。1 行が「時刻,左の向き,左の速度,右の向き,右の速度」の 5 列になっているか確認してください。',
    );
  }
  events.sort((a, b) => a.t - b.t);
  return { events, skipped };
}

function speed(direction, value) {
  const s = clamp(Math.abs(value));
  return clamp(direction ? s : -s);
}

/** 時刻 t（秒）での [左, 右]。最初の行より前は停止。 */
export function valueAt(events, t) {
  let lo = 0;
  let hi = events.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found < 0 ? [0, 0] : [events[found].left, events[found].right];
}

/** 実際に動いている範囲 { start, end }（秒）。最後まで動いたままなら end は最後の行の時刻。動きがなければ null */
export function activeRange(events) {
  const moving = (e) => e.left !== 0 || e.right !== 0;
  const first = events.findIndex(moving);
  if (first < 0) return null;
  let last = events.length - 1;
  while (!moving(events[last])) last--;
  const after = events[last + 1];
  return { start: events[first].t, end: after ? after.t : events[last].t };
}

/** 秒を「m:ss」に */
export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
