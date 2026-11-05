// 画面と UFODevice / ControlModel をつなぐ。

import { UFODevice, UNSUPPORTED_TEXT } from './device.js';
import { ControlModel, PATTERNS } from './control.js';
import { speedLabel } from './protocol.js';
import { parseVorzeCsv, valueAt, activeRange, formatTime } from './csv.js';

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

// ---- 音声同期: 再生中の音声（動画）の再生位置で CSV を引く ----

const audio = $('audio');
const video = $('video');
const sync = {
  media: null, // 今使っている <audio> か <video>
  mediaUrl: null,
  mediaName: '',
  csvName: '',
  events: null,
  csvNote: '', // 読めなかった行の数など
  csvError: '',
  mediaError: '',
};

model.setSyncSource(() => {
  const media = sync.media;
  if (!sync.events || !media || media.paused || media.ended) return [0, 0];
  return valueAt(sync.events, media.currentTime + model.syncOffset);
});

function pauseMedia() {
  if (sync.media && !sync.media.paused) sync.media.pause();
}

function loadMedia(file) {
  pauseMedia();
  if (sync.mediaUrl) URL.revokeObjectURL(sync.mediaUrl);
  const isVideo = file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm)$/i.test(file.name);
  const [use, other] = isVideo ? [video, audio] : [audio, video];
  other.removeAttribute('src');
  other.load();
  other.hidden = true;

  sync.mediaUrl = URL.createObjectURL(file);
  sync.media = use;
  sync.mediaName = file.name;
  sync.mediaError = '';
  use.src = sync.mediaUrl;
  use.hidden = false;
  use.load();
  renderSync();
}

async function loadCsv(file) {
  pauseMedia();
  sync.csvName = file.name;
  try {
    const { events, skipped } = parseVorzeCsv(await file.text());
    sync.events = events;
    sync.csvNote = skipped ? `読めなかった ${skipped} 行は飛ばしました。` : '';
    sync.csvError = '';
  } catch (e) {
    sync.events = null;
    sync.csvNote = '';
    sync.csvError = e.message;
  }
  renderSync();
}

for (const media of [audio, video]) {
  for (const type of ['loadedmetadata', 'play', 'pause', 'ended']) media.addEventListener(type, renderSync);
  // 一時停止・シーク・終了はすぐ本体に反映する（次の周期を待たない）
  for (const type of ['pause', 'seeked', 'ended']) media.addEventListener(type, () => model.tick());
  media.addEventListener('error', () => {
    if (media !== sync.media || !media.getAttribute('src')) return;
    sync.mediaError = 'このファイルは再生できませんでした。';
    renderSync();
  });
}

/** 停止ボタン・Esc・画面が隠れたとき: 音声も止めてから本体を止める */
function stopEverything() {
  pauseMedia();
  model.emergencyStop();
}

window.ufo = { device, model, sync, loadMedia, loadCsv }; // デバッグ用

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

$('media-file').addEventListener('change', (e) => {
  const [file] = e.target.files;
  if (file) loadMedia(file);
  e.target.value = ''; // 同じファイルを選び直せるように
});
$('csv-file').addEventListener('change', (e) => {
  const [file] = e.target.files;
  if (file) loadCsv(file);
  e.target.value = '';
});
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

function renderSync() {
  $('media-name').textContent = sync.mediaName || '未選択';
  $('media-name').dataset.selected = String(Boolean(sync.mediaName));
  $('csv-name').textContent = sync.csvName || '未選択';
  $('csv-name').dataset.selected = String(Boolean(sync.csvName && sync.events));

  // CSV の中身の要約。動きの範囲が音声より長ければ、組み合わせ違いかもしれないので知らせる
  const info = $('csv-info');
  if (sync.events) {
    const range = activeRange(sync.events);
    const parts = [`${sync.events.length} 行`];
    parts.push(range ? `動きがあるのは ${formatTime(range.start)}〜${formatTime(range.end)}` : '動きのある行がありません');
    const duration = sync.media?.duration;
    if (range && Number.isFinite(duration) && range.start > duration) {
      parts.push(`音声（${formatTime(duration)}）より後なので動きません`);
    } else if (range && Number.isFinite(duration) && range.end > duration + 1) {
      parts.push(`音声（${formatTime(duration)}）より長いです`);
    }
    info.textContent = `${parts.join('・')}。${sync.csvNote}`;
    info.hidden = false;
  } else {
    info.hidden = true;
  }

  const message = $('sync-message');
  const error = sync.csvError || sync.mediaError;
  const note = error
    ? { text: error, level: 'error' }
    : sync.media && !sync.media.paused && !device.isConnected
      ? { text: '未接続なので、本体は動きません。', level: 'info' }
      : sync.media && !sync.events
        ? { text: 'CSV を選ぶと、音声に合わせて動きます。', level: 'info' }
        : null;
  message.hidden = !note;
  message.textContent = note?.text ?? '';
  message.dataset.level = note?.level ?? '';
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
device.addEventListener('statechange', renderSync);
model.addEventListener('change', renderModel);
model.addEventListener('output', renderOutput);

renderDevice();
renderModel();
renderOutput();
renderSync();
model.start();
