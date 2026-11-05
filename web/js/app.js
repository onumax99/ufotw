// 画面と UFODevice / ControlModel をつなぐ。

import { UFODevice, UNSUPPORTED_TEXT } from './device.js';
import { ControlModel, PATTERNS } from './control.js';
import { speedLabel } from './protocol.js';
import { createPlayer } from './player.js';

const $ = (id) => document.getElementById(id);

// ?mock を付けるとテスト用の仮想機器を使う
let bluetooth = navigator.bluetooth;
if (new URLSearchParams(location.search).has('mock')) {
  const { createMockBluetooth } = await import('./mock.js');
  const mock = createMockBluetooth();
  bluetooth = mock.bluetooth;
  window.ufoMock = mock;
  $('mock-banner').hidden = false;
}

const device = new UFODevice(bluetooth);
const model = new ControlModel(device);

// 音声同期（プレイリスト・連続再生）は player.js
const player = createPlayer({ model, device });
const pauseMedia = () => player.pause();

/** 停止ボタン・Esc・画面が隠れたとき: 音声も止めてから本体を止める */
function stopEverything() {
  pauseMedia();
  model.emergencyStop();
}

window.ufo = { device, model, player }; // デバッグ用

// ---- パターンの種類ボタンを作る ----

const chips = PATTERNS.map(([value, label]) => {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.setAttribute('role', 'radio');
  chip.dataset.pattern = value;
  chip.textContent = label;
  chip.addEventListener('click', () => model.setPattern(value));
  $('pattern-chips').append(chip);
  return chip;
});

const modeButtons = [...document.querySelectorAll('[data-mode]')];

// ---- 操作 ----

$('connect-btn').addEventListener('click', () => {
  if (device.state === 'idle') device.connect();
  else if (device.state === 'connecting' || device.state === 'connected') model.disconnect();
});
$('show-all-btn').addEventListener('click', () => device.connect({ showAll: true }));

for (const button of modeButtons) {
  button.addEventListener('click', () => {
    if (button.dataset.mode !== 'sync') pauseMedia();
    model.setMode(button.dataset.mode);
  });
}

$('linked').addEventListener('change', (e) => model.setLinked(e.target.checked));
$('left').addEventListener('input', (e) => model.setLeft(e.target.value));
$('right').addEventListener('input', (e) => model.setRight(e.target.value));
$('zero-btn').addEventListener('click', () => model.zero());

$('intensity').addEventListener('input', (e) => model.setIntensity(e.target.value));
$('period').addEventListener('input', (e) => model.setPeriod(e.target.value));
$('mirror').addEventListener('change', (e) => model.setMirror(e.target.checked));
$('play-btn').addEventListener('click', () => model.togglePlay());

$('offset').addEventListener('input', (e) => model.setSyncOffset(e.target.value));

$('stop-btn').addEventListener('click', stopEverything);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') stopEverything();
});

// 画面が隠れたら（アプリ切り替え・画面ロック・タブ切り替え）必ず止める
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') stopEverything();
  updateWakeLock();
});
window.addEventListener('pagehide', stopEverything);

// 接続・切断したら音声も止める（つないだ瞬間に途中から動き出さないように）
device.addEventListener('statechange', pauseMedia);

// ---- 画面ロック防止（対応ブラウザのみ）。自動ロックで画面が隠れると停止してしまうため ----

let wakeLock = null;
let wakeLockBusy = false;
const wakeLockSupported = 'wakeLock' in navigator;

async function updateWakeLock() {
  if (!wakeLockSupported || wakeLockBusy) return;
  const want = device.isConnected && document.visibilityState === 'visible';
  wakeLockBusy = true;
  try {
    if (want && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
        renderDevice();
      });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    wakeLock = null;
  } finally {
    wakeLockBusy = false;
    renderDevice();
  }
}

// ---- 表示 ----

const STATUS_TEXT = {
  unsupported: () => 'Bluetooth を使えません',
  idle: () => '未接続',
  selecting: () => '機器を選んでください…',
  connecting: () => `${device.name} に接続中…`,
  connected: () => `${device.name} に接続済み`,
};

const CONNECT_BUTTON = {
  unsupported: ['探す', true],
  idle: ['探す', false],
  selecting: ['選択中…', true],
  connecting: ['キャンセル', false],
  connected: ['切断', false],
};

function renderDevice() {
  const { state } = device;
  $('status-dot').dataset.state = state;
  $('status-text').textContent = STATUS_TEXT[state]();

  const [label, disabled] = CONNECT_BUTTON[state];
  $('connect-btn').textContent = label;
  $('connect-btn').disabled = disabled;
  $('show-all-btn').hidden = state !== 'idle';

  const unsupported = state === 'unsupported';
  $('unsupported-banner').hidden = !unsupported;
  $('unsupported-banner').textContent = unsupported ? UNSUPPORTED_TEXT : '';

  const message = $('message');
  message.hidden = !device.message;
  message.textContent = device.message?.text ?? '';
  message.dataset.level = device.message?.level ?? '';

  $('packet').textContent = device.lastPacketHex;
  $('play-btn').disabled = !device.isConnected;

  $('wake-lock').textContent = !wakeLockSupported
    ? '非対応（自動ロックで停止します）'
    : wakeLock
      ? '有効'
      : device.isConnected
        ? '無効'
        : '接続中のみ有効';
}

function renderModel() {
  for (const button of modeButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === model.mode));
  }
  $('manual-section').hidden = model.mode !== 'manual';
  $('pattern-section').hidden = model.mode !== 'pattern';
  $('sync-section').hidden = model.mode !== 'sync';

  $('linked').checked = model.linked;
  setRange($('left'), model.left);
  setRange($('right'), model.right);
  $('right').disabled = model.linked;
  $('left-label').textContent = speedLabel(model.left);
  $('right-label').textContent = speedLabel(model.right);

  for (const chip of chips) {
    chip.setAttribute('aria-checked', String(chip.dataset.pattern === model.pattern));
  }
  setRange($('intensity'), model.intensity);
  setRange($('period'), model.period);
  $('intensity-label').textContent = String(model.intensity);
  $('period-label').textContent = `${model.period.toFixed(1)} 秒`;
  $('mirror').checked = model.mirror;
  $('play-btn').textContent = model.playing ? '一時停止' : '再生';

  setRange($('offset'), model.syncOffset);
  const offset = Math.abs(model.syncOffset).toFixed(2);
  $('offset-label').textContent =
    model.syncOffset === 0
      ? 'ずらしなし'
      : `${offset} 秒${model.syncOffset > 0 ? '早く' : '遅く'}`;
}

function renderOutput() {
  $('out-left').textContent = speedLabel(model.outLeft);
  $('out-right').textContent = speedLabel(model.outRight);
}

/** スライダーの値と、つまみまでの塗り（両方向スライダーは中央から）を更新する */
function setRange(input, value) {
  if (Number(input.value) !== Number(value)) input.value = String(value);
  const min = Number(input.min);
  const max = Number(input.max);
  const pos = ((Number(input.value) - min) / (max - min)) * 100;
  if (input.classList.contains('bipolar')) {
    const center = ((0 - min) / (max - min)) * 100;
    input.style.setProperty('--a', `${Math.min(center, pos)}%`);
    input.style.setProperty('--b', `${Math.max(center, pos)}%`);
    input.dataset.dir = value > 0 ? 'fwd' : value < 0 ? 'rev' : 'zero';
  } else {
    input.style.setProperty('--a', '0%');
    input.style.setProperty('--b', `${pos}%`);
  }
}

device.addEventListener('change', renderDevice);
device.addEventListener('statechange', updateWakeLock);
model.addEventListener('change', renderModel);
model.addEventListener('output', renderOutput);

renderDevice();
renderModel();
renderOutput();
model.start();
