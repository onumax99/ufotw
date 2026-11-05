// プレイリスト（並べ替え・CSV の割り当て・再生対象の追従）を確かめる。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Playlist, naturalCompare, normalizeName, isVideoFile } from '../../web/js/playlist.js';

const file = (name, type = 'audio/mpeg') => ({ name, type });
const csv = (name) => ({ name, events: [{ t: 1, left: 40, right: 40 }], skipped: 0 });
const titles = (p) => p.tracks.map((t) => t.title);

test('名前は数字の大小で並べる', () => {
  const names = ['10_end.mp3', '2_b.mp3', '1_a.mp3', 'トラック１１.mp3', 'トラック３.mp3'];
  assert.deepEqual([...names].sort(naturalCompare), ['1_a.mp3', '2_b.mp3', '10_end.mp3', 'トラック３.mp3', 'トラック１１.mp3']);
});

test('名前の照合は拡張子・空白・大文字小文字・全角半角を無視する', () => {
  assert.equal(normalizeName('Track 01.MP3'), normalizeName('track01.csv'));
  assert.equal(normalizeName('トラック０１.mp3'), normalizeName('トラック01.csv'));
  assert.notEqual(normalizeName('track01.mp3'), normalizeName('track02.csv'));
});

test('動画かどうか', () => {
  assert.ok(isVideoFile(file('a.mp4', '')));
  assert.ok(isVideoFile(file('a.bin', 'video/quicktime')));
  assert.ok(!isVideoFile(file('a.mp3')));
});

test('追加すると名前順に末尾へ並び、最初のトラックが再生対象になる', () => {
  const p = new Playlist();
  p.addFiles([file('02.mp3'), file('01.mp3')]);
  assert.deepEqual(titles(p), ['01', '02']);
  assert.equal(p.current, 0);
  p.addFiles([file('00.mp3')]); // 後から足した分は末尾
  assert.deepEqual(titles(p), ['01', '02', '00']);
  assert.equal(p.current, 0);
});

test('CSV は名前が同じトラックに付く。合わないものは残す', () => {
  const p = new Playlist();
  p.addFiles([file('01_intro.mp3'), file('02_main.mp3'), file('03_end.mp3')]);
  const { assigned, unmatched } = p.assignCsvs([csv('02_main.csv'), csv('03_END.csv'), csv('bonus.csv')]);
  assert.deepEqual(assigned, [
    { csv: '02_main.csv', track: 1 },
    { csv: '03_END.csv', track: 2 },
  ]);
  assert.deepEqual(unmatched, ['bonus.csv']);
  assert.equal(p.tracks[0].csv, null); // CSV のないトラックもある
  assert.equal(p.tracks[1].csv.name, '02_main.csv');
  assert.deepEqual(p.tracks[1].csv.range, { start: 1, end: null });
});

test('名前が違っても、CSV を 1 つだけ選び、CSV のないトラックも 1 つなら組にする', () => {
  const p = new Playlist();
  p.addFiles([file('本編.mp3')]);
  const { assigned, unmatched } = p.assignCsvs([csv('【UFOTW】サンプル.csv')]);
  assert.deepEqual(assigned, [{ csv: '【UFOTW】サンプル.csv', track: 0 }]);
  assert.deepEqual(unmatched, []);

  // ほかのトラックに CSV が付いていて、残り 1 つに名前の違う CSV を 1 つ足すとき
  const q = new Playlist();
  q.addFiles([file('01.mp3'), file('02.mp3')]);
  q.assignCsvs([csv('01.csv')]);
  assert.deepEqual(q.assignCsvs([csv('別名.csv')]).assigned, [{ csv: '別名.csv', track: 1 }]);
});

test('名前が違う CSV が複数あるときは勝手に組にしない', () => {
  const p = new Playlist();
  p.addFiles([file('a.mp3'), file('b.mp3')]);
  const { assigned, unmatched } = p.assignCsvs([csv('x.csv'), csv('y.csv')]);
  assert.deepEqual(assigned, []);
  assert.deepEqual(unmatched, ['x.csv', 'y.csv']);
});

test('並べ替えても再生対象は同じトラックのまま', () => {
  const p = new Playlist();
  p.addFiles([file('1.mp3'), file('2.mp3'), file('3.mp3')]);
  p.current = 1; // 「2」
  p.move(1, -1);
  assert.deepEqual(titles(p), ['2', '1', '3']);
  assert.equal(p.currentTrack.title, '2');
  p.move(2, -1);
  assert.deepEqual(titles(p), ['2', '3', '1']);
  assert.equal(p.currentTrack.title, '2');
  assert.equal(p.move(0, -1), false); // 端より外へは動かない
});

test('外したときの再生対象', () => {
  const p = new Playlist();
  p.addFiles([file('1.mp3'), file('2.mp3'), file('3.mp3')]);
  p.current = 1;
  assert.equal(p.remove(0), false); // 前を外す → 番号だけずれる
  assert.equal(p.currentTrack.title, '2');
  assert.equal(p.remove(0), true); // 再生対象を外す → 次のトラック
  assert.equal(p.currentTrack.title, '3');
  assert.equal(p.remove(0), true); // 最後の 1 つ
  assert.equal(p.current, -1);
  assert.equal(p.currentTrack, null);
});

test('最後のトラックを外したら前のトラックが再生対象', () => {
  const p = new Playlist();
  p.addFiles([file('1.mp3'), file('2.mp3')]);
  p.current = 1;
  p.remove(1);
  assert.equal(p.currentTrack.title, '1');
});

test('前後のトラックの有無', () => {
  const p = new Playlist();
  assert.equal(p.hasNext, false);
  assert.equal(p.hasPrev, false);
  p.addFiles([file('1.mp3'), file('2.mp3')]);
  assert.equal(p.hasNext, true);
  assert.equal(p.hasPrev, false);
  p.current = 1;
  assert.equal(p.hasNext, false);
  assert.equal(p.hasPrev, true);
});
