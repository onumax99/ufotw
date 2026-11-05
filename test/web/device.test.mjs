// UFODevice の送信制御を仮想機器（web/js/mock.js）で確かめる。
import test from 'node:test';
import assert from 'node:assert/strict';
import { UFODevice } from '../../web/js/device.js';
import { createMockBluetooth } from '../../web/js/mock.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connected(options) {
  const mock = createMockBluetooth({ latencyMs: 10, ...options });
  const device = new UFODevice(mock.bluetooth);
  await device.connect();
  await sleep(30);
  return { mock, device };
}

test('Web Bluetooth がなければ unsupported', () => {
  const device = new UFODevice(undefined);
  assert.equal(device.state, 'unsupported');
});

test('名前で絞り込んで機器を選ぶ', async () => {
  const { mock } = await connected();
  assert.deepEqual(mock.bluetooth.lastOptions.filters, [{ namePrefix: 'UFO-' }, { namePrefix: 'UFO ' }]);
  assert.deepEqual(mock.bluetooth.lastOptions.optionalServices, ['40ee1111-63ec-4b7f-8ce7-712efd55b90e']);
});

test('接続直後に停止パケットを送る', async () => {
  const { mock, device } = await connected();
  assert.equal(device.state, 'connected');
  assert.deepEqual(mock.log, ['connect', '05 80 80']);
});

test('送信中に来た値は最新のものだけを、前の書き込みが終わってから送る', async () => {
  const { mock, device } = await connected();
  device.setSpeeds(10, 10); // すぐ送られる
  device.setSpeeds(20, 20); // 送信中なので待つ
  device.setSpeeds(30, -30); // 上書きされる
  await sleep(60);
  // 仮想機器は同時に 2 件書くとエラーにするので、エラーが出ていないことも確認
  assert.equal(device.message, null);
  assert.deepEqual(mock.log.slice(2), ['05 8A 8A', '05 9E 1E']);
});

test('同じ値は送り直さない', async () => {
  const { mock, device } = await connected();
  for (let i = 0; i < 5; i++) {
    device.setSpeeds(40, 40);
    await sleep(15);
  }
  assert.deepEqual(mock.log.slice(2), ['05 A8 A8']);
});

test('切断するときは停止を送ってから切る', async () => {
  const { mock, device } = await connected();
  device.setSpeeds(60, 60);
  await sleep(20);
  await device.disconnect();
  assert.equal(device.state, 'idle');
  assert.deepEqual(mock.log.slice(-3), ['05 BC BC', '05 80 80', 'disconnect']);
  // 切断処理の後は何も送らない
  device.setSpeeds(50, 50);
  await sleep(20);
  assert.equal(mock.log.at(-1), 'disconnect');
});

test('機器側から切れたら未接続に戻り、メッセージを出す', async () => {
  const { mock, device } = await connected();
  const states = [];
  device.addEventListener('statechange', () => states.push(device.state));
  mock.dropConnection();
  assert.equal(device.state, 'idle');
  assert.deepEqual(states, ['idle']);
  assert.equal(device.message?.level, 'error');
});

test('選択画面でキャンセルしたら未接続のまま', async () => {
  const mock = createMockBluetooth({ latencyMs: 5, cancel: true });
  const device = new UFODevice(mock.bluetooth);
  await device.connect();
  assert.equal(device.state, 'idle');
  assert.equal(device.message?.level, 'info');
  assert.deepEqual(mock.log, []);
});

test('すべての機器から選んだときは U.F.O. TW 以外を断る', async () => {
  const mock = createMockBluetooth({ latencyMs: 5, name: 'UFOSA' });
  const device = new UFODevice(mock.bluetooth);
  await device.connect({ showAll: true });
  assert.deepEqual(mock.bluetooth.lastOptions.filters, [{ services: ['40ee1111-63ec-4b7f-8ce7-712efd55b90e'] }]);
  assert.equal(device.state, 'idle');
  assert.equal(device.message?.level, 'error');
  assert.deepEqual(mock.log, []);
});

test('接続中にキャンセルしたら、遅れてつながっても切る', async () => {
  const mock = createMockBluetooth({ latencyMs: 20 });
  const device = new UFODevice(mock.bluetooth);
  const connecting = device.connect();
  await sleep(30); // 機器を選び終えて gatt.connect() の途中
  assert.equal(device.state, 'connecting');
  await device.disconnect();
  await connecting;
  await sleep(30);
  assert.equal(device.state, 'idle');
  assert.deepEqual(mock.log, ['connect', 'disconnect']);
});
