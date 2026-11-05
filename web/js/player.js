// 音声同期の画面: プレイリスト・連続再生・CSV の割り当て。
// 再生中の <audio> / <video> の currentTime で CSV を引き、ControlModel に渡す。
//
// 安全のきまり: CSV のないトラック・一時停止中・トラックの切り替え中は [0, 0]。
// 再生中のトラックの CSV を付け替えたときは一時停止する（途中から急に動き出さないように）。

import { Playlist } from './playlist.js';
import { parseVorzeCsv, valueAt, formatTime, formatRange } from './csv.js';

const $ = (id) => document.getElementById(id);

export function createPlayer({ model, device }) {
  const audio = $('audio');
  const video = $('video');
  const list = $('track-list');
  const playlist = new Playlist();
  const state = {
    media: null, // 読み込み中の <audio> か <video>
    url: null,
    loadedId: null, // 読み込み中のトラックの id
    notice: null, // 直前の操作の結果 { text, level }
  };

  model.setSyncSource(() => {
    const track = playlist.currentTrack;
    const media = state.media;
    if (!track?.csv || !media || media.paused || media.ended || state.loadedId !== track.id) return [0, 0];
    return valueAt(track.csv.events, media.currentTime + model.syncOffset);
  });

  // ---- 再生 ----

  function isPlaying() {
    return Boolean(state.media && !state.media.paused && !state.media.ended);
  }

  function pause() {
    if (state.media && !state.media.paused) state.media.pause();
  }

  function unload() {
    pause();
    for (const media of [audio, video]) {
      if (media.getAttribute('src')) {
        media.removeAttribute('src');
        media.load();
      }
      media.hidden = true;
    }
    if (state.url) URL.revokeObjectURL(state.url);
    Object.assign(state, { media: null, url: null, loadedId: null });
  }

  /** index のトラックを読み込む。autoplay なら再生も始める */
  function load(index, { autoplay = false } = {}) {
    const track = playlist.tracks[index];
    if (!track) {
      unload();
      render();
      return;
    }
    const media = track.isVideo ? video : audio;
    const other = media === audio ? video : audio;
    pause();
    if (other.getAttribute('src')) {
      other.removeAttribute('src');
      other.load();
    }
    other.hidden = true;
    if (state.url) URL.revokeObjectURL(state.url);

    playlist.current = index;
    state.url = URL.createObjectURL(track.file);
    state.media = media;
    state.loadedId = track.id;
    media.src = state.url;
    media.hidden = false;
    media.load();
    if (autoplay) {
      media.play().catch(() => {
        state.notice = { text: 'プレーヤーの ▶ を押すと再生します。', level: 'info' };
        render();
      });
    }
    render();
  }

  for (const media of [audio, video]) {
    for (const type of ['loadedmetadata', 'play', 'pause']) media.addEventListener(type, render);
    // 一時停止・シーク・終了はすぐ本体に反映する（次の周期を待たない）
    for (const type of ['pause', 'seeked', 'ended']) media.addEventListener(type, () => model.tick());

    // 終わったら次のトラックへ
    media.addEventListener('ended', () => {
      if (media !== state.media) return;
      if (playlist.hasNext) {
        load(playlist.current + 1, { autoplay: true });
      } else {
        state.notice = { text: '最後まで再生しました。', level: 'info' };
        render();
      }
    });

    media.addEventListener('error', () => {
      if (media !== state.media || !media.getAttribute('src')) return;
      state.notice = { text: `「${playlist.currentTrack?.title}」を再生できませんでした。`, level: 'error' };
      render();
    });
  }

  // ---- ファイルの追加 ----

  function addTracks(files) {
    state.notice = null;
    const added = playlist.addFiles(files);
    if (added.length && state.loadedId === null) load(playlist.current);
    else render();
  }

  async function readCsv(file) {
    try {
      return { name: file.name, ...parseVorzeCsv(await file.text()) };
    } catch (e) {
      return { name: file.name, error: e.message };
    }
  }

  function pauseIfCurrent(index) {
    if (index === playlist.current) pause();
  }

  async function addCsvs(files) {
    state.notice = null;
    const results = await Promise.all([...files].map(readCsv));
    const ok = results.filter((r) => !r.error);
    const failed = results.filter((r) => r.error);
    const { assigned, unmatched } = playlist.assignCsvs(ok);
    for (const a of assigned) pauseIfCurrent(a.track);

    const lines = [];
    if (assigned.length) lines.push(`${assigned.length} 件の CSV をトラックに付けました。`);
    if (unmatched.length) {
      lines.push(`名前の合うトラックがなかった CSV: ${unmatched.join('、')}。各トラックの「CSV」から選んでください。`);
    }
    if (failed.length) lines.push(`読めなかった CSV: ${failed.map((r) => r.name).join('、')}（5 列の U.F.O. TW 用か確認してください）。`);
    state.notice = lines.length
      ? { text: lines.join(' '), level: failed.length || unmatched.length ? 'error' : 'info' }
      : null;
    render();
  }

  async function setTrackCsv(index, file) {
    state.notice = null;
    const result = await readCsv(file);
    if (result.error) {
      state.notice = { text: `${result.name}: ${result.error}`, level: 'error' };
    } else {
      playlist.setCsv(index, result);
      pauseIfCurrent(index);
    }
    render();
  }

  // ---- 操作 ----

  function prev() {
    state.notice = null;
    if (state.media && state.media.currentTime > 3) {
      state.media.currentTime = 0; // 曲の途中なら頭に戻る
    } else if (playlist.hasPrev) {
      load(playlist.current - 1, { autoplay: isPlaying() });
    }
  }

  function next() {
    state.notice = null;
    if (playlist.hasNext) load(playlist.current + 1, { autoplay: isPlaying() });
  }

  function playOrToggle(index) {
    state.notice = null;
    if (index === playlist.current && state.loadedId === playlist.currentTrack?.id) {
      if (isPlaying()) pause();
      else state.media.play().catch(() => {});
    } else {
      load(index, { autoplay: true });
    }
  }

  function remove(index) {
    state.notice = null;
    const changed = playlist.remove(index);
    if (changed) {
      unload();
      if (playlist.currentTrack) load(playlist.current);
    }
    render();
  }

  function clearAll() {
    state.notice = null;
    unload();
    playlist.clear();
    render();
  }

  list.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    const item = e.target.closest('[data-index]');
    if (!target || !item || target.tagName === 'INPUT') return;
    const index = Number(item.dataset.index);
    switch (target.dataset.action) {
      case 'play':
        playOrToggle(index);
        break;
      case 'up':
      case 'down':
        playlist.move(index, target.dataset.action === 'up' ? -1 : 1);
        render();
        break;
      case 'clear-csv':
        playlist.clearCsv(index);
        render();
        break;
      case 'remove':
        remove(index);
        break;
    }
  });

  list.addEventListener('change', (e) => {
    const input = e.target;
    if (input.dataset.action !== 'csv') return;
    const [file] = input.files;
    const index = Number(input.closest('[data-index]').dataset.index);
    if (file) setTrackCsv(index, file);
  });

  $('tracks-file').addEventListener('change', (e) => {
    if (e.target.files.length) addTracks(e.target.files);
    e.target.value = ''; // 同じファイルを選び直せるように
  });
  $('csvs-file').addEventListener('change', (e) => {
    if (e.target.files.length) addCsvs(e.target.files);
    e.target.value = '';
  });
  $('prev-btn').addEventListener('click', prev);
  $('next-btn').addEventListener('click', next);
  $('clear-tracks').addEventListener('click', clearAll);
  device.addEventListener('statechange', render);

  // ---- 表示 ----

  function csvSummary(track) {
    if (!track.csv) return 'CSV なし（このトラックでは動きません）';
    const range = track.csv.range;
    return `${track.csv.name}・${range ? formatRange(range) : '動きなし'}`;
  }

  function renderTrack(track, index) {
    const li = document.createElement('li');
    li.className = 'track';
    li.dataset.index = String(index);
    const current = index === playlist.current;
    if (current) li.setAttribute('aria-current', 'true');

    const main = button('track-main', 'play', '');
    main.setAttribute('aria-label', `${index + 1}. ${track.title} を${current && isPlaying() ? '一時停止' : '再生'}`);
    const no = span('track-no', current && isPlaying() ? '▶' : String(index + 1));
    const text = span('track-text', '');
    text.append(span('track-title', track.title), span('track-csv', csvSummary(track)));
    text.lastChild.dataset.has = String(Boolean(track.csv));
    main.append(no, text);

    const actions = document.createElement('div');
    actions.className = 'track-actions';
    const csvLabel = document.createElement('label');
    csvLabel.className = 'mini-btn';
    csvLabel.textContent = track.csv ? 'CSV 変更' : 'CSV';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv,text/plain';
    input.className = 'visually-hidden';
    input.dataset.action = 'csv';
    input.setAttribute('aria-label', `${track.title} の CSV を選ぶ`);
    csvLabel.append(input);
    actions.append(csvLabel);
    if (track.csv) actions.append(button('mini-btn', 'clear-csv', 'CSV を外す'));
    // 並べ替え・削除はひとまとまりで右端へ（幅が足りなければまとめて次の行へ）
    const order = document.createElement('div');
    order.className = 'track-order';
    const up = button('icon-btn', 'up', '↑', '上へ');
    const down = button('icon-btn', 'down', '↓', '下へ');
    const del = button('icon-btn', 'remove', '✕', 'プレイリストから外す');
    up.disabled = index === 0;
    down.disabled = index === playlist.tracks.length - 1;
    order.append(up, down, del);
    actions.append(order);

    li.append(main, actions);
    return li;
  }

  function render() {
    const hasTracks = playlist.tracks.length > 0;
    list.replaceChildren(...playlist.tracks.map(renderTrack));
    list.hidden = !hasTracks;
    $('csvs-file').disabled = !hasTracks;
    $('csvs-label').classList.toggle('disabled', !hasTracks);
    $('clear-tracks').hidden = !hasTracks;

    const track = playlist.currentTrack;
    $('player').hidden = !track;
    $('prev-btn').disabled = !track;
    $('next-btn').disabled = !playlist.hasNext;
    $('now-playing').textContent = track ? `${playlist.current + 1} / ${playlist.tracks.length}・${track.title}` : '';

    // 再生中のトラックの CSV の要約。動きの範囲が音声より長ければ、組み合わせ違いかもしれないので知らせる
    const info = $('csv-info');
    if (track?.csv) {
      const { events, range, note } = track.csv;
      const parts = [`CSV ${events.length} 行`];
      parts.push(range ? `動きがあるのは ${formatRange(range)}` : '動きのある行がありません');
      const duration = state.loadedId === track.id ? state.media?.duration : NaN;
      if (range && Number.isFinite(duration) && range.start > duration) {
        parts.push(`音声（${formatTime(duration)}）より後なので動きません`);
      } else if (range && range.end !== null && Number.isFinite(duration) && range.end > duration + 1) {
        parts.push(`音声（${formatTime(duration)}）より長いです`);
      }
      info.textContent = `${parts.join('・')}。${note}`;
      info.hidden = false;
    } else {
      info.hidden = true;
    }

    const message = $('sync-message');
    const note =
      state.notice ??
      (!hasTracks
        ? { text: 'トラック（音声・動画）を追加してください。', level: 'info' }
        : isPlaying() && !device.isConnected
          ? { text: '未接続なので、本体は動きません。', level: 'info' }
          : null);
    message.hidden = !note;
    message.textContent = note?.text ?? '';
    message.dataset.level = note?.level ?? '';
  }

  render();
  return { playlist, pause, render, addTracks, addCsvs, setTrackCsv, load, next, prev };
}

function button(className, action, text, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.dataset.action = action;
  b.textContent = text;
  if (label) b.setAttribute('aria-label', label);
  return b;
}

function span(className, text) {
  const s = document.createElement('span');
  s.className = className;
  s.textContent = text;
  return s;
}
