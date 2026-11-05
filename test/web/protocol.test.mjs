// パケットが buttplug のテストデータ（test_vorze_ufo_tw.yaml）と一致することを確かめる。
import test from 'node:test';
import assert from 'node:assert/strict';
import { packet, toHex, encode, clamp, isUFOTW, speedLabel } from '../../web/js/protocol.js';

test('buttplug のテストデータと同じバイト列になる', () => {
  assert.equal(toHex(packet(0, 0)), '05 80 80'); // 停止
  assert.equal(toHex(packet(50, 0)), '05 B2 80'); // 左 CW 50
  assert.equal(toHex(packet(-99, 0)), '05 63 80'); // 左 CCW 99
  assert.equal(toHex(packet(-99, 25)), '05 63 99'); // 左 CCW 99・右 CW 25
});

test('速度は -99〜99 の整数に丸める', () => {
  assert.equal(clamp(150), 99);
  assert.equal(clamp(-150), -99);
  assert.equal(clamp(12.4), 12);
  assert.equal(clamp(-0.2), 0);
  assert.ok(Object.is(clamp(-0.2), 0), '-0 にならない');
  assert.equal(clamp('abc'), 0);
  assert.equal(encode(200), 0x80 | 99);
  assert.equal(encode(-200), 99);
});

test('U.F.O. TW の名前だけを対象にする', () => {
  assert.ok(isUFOTW('UFO-TW'));
  assert.ok(isUFOTW('UFO-'));
  assert.ok(isUFOTW('UFO TW'));
  assert.ok(!isUFOTW('UFOSA'));
  assert.ok(!isUFOTW('CycSA'));
  assert.ok(!isUFOTW(''));
  assert.ok(!isUFOTW(undefined));
});

test('表示用ラベル', () => {
  assert.equal(speedLabel(0), '停止');
  assert.equal(speedLabel(50), '正転 50');
  assert.equal(speedLabel(-30), '逆転 30');
});
