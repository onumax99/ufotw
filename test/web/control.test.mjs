// ControlModel とパターン計算を確かめる。
import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlModel, patternOutput, RandomWalk } from '../../web/js/control.js';

/** setSpeeds / stopAll の呼び出しを記録するだけの機器 */
function fakeDevice() {
  const device = new EventTarget();
  device.sent = [];
  device.setSpeeds = (l, r) => device.sent.push([l, r]);
  device.stopAll = () => device.sent.push(['stop']);
  device.disconnect = async () => device.sent.push(['disconnect']);
  return device;
}

const settings = { intensity: 60, period: 2, mirror: false };

test('ウェーブは 0 → 最大 → 0', () => {
  assert.deepEqual(patternOutput('wave', 0, settings), [0, 0]);
  assert.deepEqual(patternOutput('wave', 1, settings), [60, 60]);
  assert.deepEqual(patternOutput('wave', 0.5, settings), [30, 30]);
});

test('交互反転は周期の後半で逆転', () => {
  assert.deepEqual(patternOutput('alternate', 0.2, settings), [60, 60]);
  assert.deepEqual(patternOutput('alternate', 1.2, settings), [-60, -60]);
});

test('パルスは前半だけ動く', () => {
  assert.deepEqual(patternOutput('pulse', 0.5, settings), [60, 60]);
  assert.deepEqual(patternOutput('pulse', 1.5, settings), [0, 0]);
});

test('右を逆回転にすると右は左の反対', () => {
  assert.deepEqual(patternOutput('constant', 0, { ...settings, mirror: true }), [60, -60]);
  assert.deepEqual(patternOutput('constant', 0, { ...settings, intensity: 0, mirror: true }), [0, 0]);
});

test('ランダムは強さの範囲に収まる', () => {
  const walk = new RandomWalk();
  for (let i = 0; i < 400; i++) {
    const [l, r] = walk.next(i * 0.05, { intensity: 40, period: 1, mirror: false });
    assert.ok(Math.abs(l) <= 40 && Math.abs(r) <= 40);
  }
});

test('手動: 連動中は左右が同じ値になる', () => {
  const device = fakeDevice();
  const model = new ControlModel(device);
  model.setLeft(30);
  model.tick();
  assert.deepEqual(device.sent.at(-1), [30, 30]);

  model.setLinked(false);
  model.setRight(-20);
  model.tick();
  assert.deepEqual(device.sent.at(-1), [30, -20]);
});

test('パターン: 再生していなければ 0 を送る', () => {
  let now = 0;
  const device = fakeDevice();
  const model = new ControlModel(device, { now: () => now });
  model.setMode('pattern');
  model.setPattern('constant');
  model.tick();
  assert.deepEqual(device.sent.at(-1), [0, 0]);

  model.togglePlay();
  now = 0.5;
  model.tick();
  assert.deepEqual(device.sent.at(-1), [60, 60]);
  assert.equal(model.outLeft, 60);
});

test('接続状態が変わったら出力をゼロに戻す', () => {
  const device = fakeDevice();
  const model = new ControlModel(device);
  model.setLeft(50);
  model.setMode('pattern');
  model.togglePlay();
  device.dispatchEvent(new Event('statechange'));
  assert.equal(model.left, 0);
  assert.equal(model.right, 0);
  assert.equal(model.playing, false);
});

test('モードを切り替えると出力をゼロに戻す', () => {
  const device = fakeDevice();
  const model = new ControlModel(device);
  model.setLeft(50);
  model.setMode('pattern');
  model.setMode('manual');
  model.tick();
  assert.deepEqual(device.sent.at(-1), [0, 0]);
});

test('音声同期: 取り出し口の値を送り、なければ 0', () => {
  const device = fakeDevice();
  const model = new ControlModel(device);
  model.setMode('sync');
  model.tick();
  assert.deepEqual(device.sent.at(-1), [0, 0]);

  let value = [40, -35];
  model.setSyncSource(() => value);
  model.tick();
  assert.deepEqual(device.sent.at(-1), [40, -35]);
  assert.deepEqual([model.outLeft, model.outRight], [40, -35]);

  value = [150, -150]; // 範囲外は丸める
  model.tick();
  assert.deepEqual(device.sent.at(-1), [99, -99]);

  // 手動に戻したら取り出し口は使わない
  model.setMode('manual');
  model.tick();
  assert.deepEqual(device.sent.at(-1), [0, 0]);
});

test('音声同期: タイミング調整は ±1 秒、0.01 秒単位', () => {
  const model = new ControlModel(fakeDevice());
  model.setSyncOffset('0.25');
  assert.equal(model.syncOffset, 0.25);
  model.setSyncOffset(-3);
  assert.equal(model.syncOffset, -1);
  model.setSyncOffset(0.1 + 0.2);
  assert.equal(model.syncOffset, 0.3);
});

test('停止ボタンは出力を戻してから停止を送る', () => {
  const device = fakeDevice();
  const model = new ControlModel(device);
  model.setLeft(70);
  model.emergencyStop();
  assert.equal(model.left, 0);
  assert.deepEqual(device.sent.at(-1), ['stop']);
});
