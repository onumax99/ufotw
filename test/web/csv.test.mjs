// 連動 CSV の読み込みと、再生位置からの値の引き当てを確かめる。
// テスト用の CSV はここで作ったもの（市販作品の CSV はリポジトリに入れない）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVorzeCsv, valueAt, activeRange, formatTime, formatRange } from '../../web/js/csv.js';
import { packet, toHex } from '../../web/js/protocol.js';

const SAMPLE = ['10,0,0,0,0', '100,0,40,0,40', '105,1,40,1,40', '110,1,0,1,0', '120,1,55,0,35', '130,0,0,0,0'].join('\n');

test('時刻は 0.1 秒単位、向き 1 は正転・0 は逆転', () => {
  const { events, skipped } = parseVorzeCsv(SAMPLE);
  assert.equal(skipped, 0);
  assert.deepEqual(events[1], { t: 10, left: -40, right: -40 });
  assert.deepEqual(events[2], { t: 10.5, left: 40, right: 40 });
  assert.deepEqual(events[4], { t: 12, left: 55, right: -35 });
});

test('送るバイトは「向き × 0x80 + 速度」と同じになる', () => {
  const { events } = parseVorzeCsv('0,1,40,0,35\n');
  const [left, right] = valueAt(events, 0);
  assert.equal(toHex(packet(left, right)), `05 ${(0x80 | 40).toString(16).toUpperCase()} 23`);
});

test('その時刻から次の行まで同じ値を保つ', () => {
  const { events } = parseVorzeCsv(SAMPLE);
  assert.deepEqual(valueAt(events, 0), [0, 0]); // 最初の行より前
  assert.deepEqual(valueAt(events, 9.99), [0, 0]);
  assert.deepEqual(valueAt(events, 10), [-40, -40]);
  assert.deepEqual(valueAt(events, 10.4), [-40, -40]);
  assert.deepEqual(valueAt(events, 10.5), [40, 40]);
  assert.deepEqual(valueAt(events, 12.9), [55, -35]);
  assert.deepEqual(valueAt(events, 13), [0, 0]);
  assert.deepEqual(valueAt(events, 9999), [0, 0]); // 最後の行より後
});

test('BOM・CRLF・見出し行・空行があっても読める', () => {
  const { events, skipped } = parseVorzeCsv('﻿time,ldir,lspeed,rdir,rspeed\r\n\r\n10,1,20,1,20\r\n20,0,0,0,0\r\n');
  assert.equal(events.length, 2);
  assert.equal(skipped, 1);
  assert.deepEqual(events[0], { t: 1, left: 20, right: 20 });
});

test('時刻順に並べ直す', () => {
  const { events } = parseVorzeCsv('30,1,10,1,10\n10,1,30,1,30\n20,1,20,1,20');
  assert.deepEqual(events.map((e) => e.t), [1, 2, 3]);
});

test('速度 100 は 99 に丸める', () => {
  const { events } = parseVorzeCsv('0,1,100,0,100');
  assert.deepEqual(events[0], { t: 0, left: 99, right: -99 });
});

test('5 列でない CSV（初代 SA 用の 3 列など）はエラー', () => {
  assert.throws(() => parseVorzeCsv('10,1,40\n20,0,30\n'), /5 列/);
  assert.throws(() => parseVorzeCsv(''), /5 列/);
});

test('動きのある範囲', () => {
  const { events } = parseVorzeCsv(SAMPLE);
  assert.deepEqual(activeRange(events), { start: 10, end: 13 });
  assert.equal(activeRange(parseVorzeCsv('10,0,0,0,0').events), null);
  // 最後の行でも動いたままなら end は null（音声の終わりまで動く）
  const open = activeRange(parseVorzeCsv('10,1,20,1,20\n50,1,30,1,30').events);
  assert.deepEqual(open, { start: 1, end: null });
  assert.equal(formatRange(open), '0:01〜最後まで');
  assert.equal(formatRange({ start: 175.2, end: 438.8 }), '2:55〜7:18');
});

test('時刻の表示', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(175.2), '2:55');
  assert.equal(formatTime(2138.6), '35:38');
  assert.equal(formatTime(3725), '1:02:05');
});
