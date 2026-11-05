// 音声同期のプレイリスト。画面（DOM）には触らない。
// トラック = 音声か動画のファイル 1 つ + あれば連動 CSV 1 つ（CSV がないトラックでは動かない）。

import { activeRange } from './csv.js';

const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

/** 「2.mp3」が「10.mp3」より前に来る並べ方 */
export function naturalCompare(a, b) {
  return collator.compare(a, b);
}

/** 名前の照合用: 拡張子・空白・大文字小文字・全角半角の違いを無視する */
export function normalizeName(name) {
  return String(name)
    .normalize('NFKC')
    .replace(/\.[^./\\]+$/, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function stripExtension(name) {
  return String(name).replace(/\.[^./\\]+$/, '');
}

export function isVideoFile(file) {
  return (file.type || '').startsWith('video/') || /\.(mp4|m4v|mov|webm)$/i.test(file.name);
}

/**
 * @typedef {{ name: string, events: { t: number, left: number, right: number }[], note: string,
 *             range: { start: number, end: number } | null }} TrackCsv
 * @typedef {{ id: number, file: File, title: string, isVideo: boolean, csv: TrackCsv | null }} Track
 */

export class Playlist {
  constructor() {
    /** @type {Track[]} */
    this.tracks = [];
    /** 再生対象のトラックの番号（なければ -1） */
    this.current = -1;
    this._nextId = 1;
  }

  get currentTrack() {
    return this.tracks[this.current] ?? null;
  }

  get hasNext() {
    return this.current >= 0 && this.current < this.tracks.length - 1;
  }

  get hasPrev() {
    return this.current > 0;
  }

  /** ファイルを名前順に並べて末尾に追加する。追加したトラックを返す */
  addFiles(files) {
    const added = [...files]
      .sort((a, b) => naturalCompare(a.name, b.name))
      .map((file) => ({ id: this._nextId++, file, title: stripExtension(file.name), isVideo: isVideoFile(file), csv: null }));
    this.tracks.push(...added);
    if (this.current < 0 && this.tracks.length > 0) this.current = 0;
    return added;
  }

  /** CSV を読み込み済みの結果 { name, events, skipped } からトラックに付ける */
  setCsv(index, { name, events, skipped = 0 }) {
    const track = this.tracks[index];
    if (!track) return;
    track.csv = {
      name,
      events,
      note: skipped ? `読めなかった ${skipped} 行は飛ばしました。` : '',
      range: activeRange(events),
    };
  }

  clearCsv(index) {
    const track = this.tracks[index];
    if (track) track.csv = null;
  }

  /**
   * 複数の CSV を、名前の同じトラックに割り当てる。
   * CSV を 1 つだけ選んで名前が合わず、CSV のないトラックもちょうど 1 つなら、それどうしを組にする
   * （音声 1 つと CSV 1 つを選ぶだけの使い方で、名前が違っても困らないように）。
   * 複数まとめて選んだときの余りは、取り違えを避けるため勝手には付けない。
   * @param {{ name: string, events: any[], skipped?: number }[]} csvs 読み込み済みの CSV
   * @returns {{ assigned: { csv: string, track: number }[], unmatched: string[] }}
   */
  assignCsvs(csvs) {
    const assigned = [];
    const rest = [];
    for (const csv of csvs) {
      const key = normalizeName(csv.name);
      const hits = this.tracks.flatMap((t, i) => (normalizeName(t.file.name) === key ? [i] : []));
      if (hits.length === 1) {
        this.setCsv(hits[0], csv);
        assigned.push({ csv: csv.name, track: hits[0] });
      } else {
        rest.push(csv);
      }
    }

    const withoutCsv = this.tracks.flatMap((t, i) => (t.csv ? [] : [i]));
    if (csvs.length === 1 && rest.length === 1 && withoutCsv.length === 1) {
      this.setCsv(withoutCsv[0], rest[0]);
      assigned.push({ csv: rest[0].name, track: withoutCsv[0] });
      rest.length = 0;
    }
    return { assigned, unmatched: rest.map((c) => c.name) };
  }

  /** トラックを 1 つ上（-1）か下（+1）へ動かす。再生対象は同じトラックのまま */
  move(index, delta) {
    const to = index + delta;
    if (index < 0 || index >= this.tracks.length || to < 0 || to >= this.tracks.length) return false;
    const currentId = this.currentTrack?.id;
    const [track] = this.tracks.splice(index, 1);
    this.tracks.splice(to, 0, track);
    this.current = this.tracks.findIndex((t) => t.id === currentId);
    return true;
  }

  /**
   * トラックを外す。再生対象を外したときは、次のトラック（なければ前）が再生対象になる。
   * @returns {boolean} 再生対象が変わったら true
   */
  remove(index) {
    if (index < 0 || index >= this.tracks.length) return false;
    const wasCurrent = index === this.current;
    this.tracks.splice(index, 1);
    if (this.tracks.length === 0) {
      this.current = -1;
    } else if (index < this.current) {
      this.current--;
    } else if (wasCurrent) {
      this.current = Math.min(index, this.tracks.length - 1);
    }
    return wasCurrent;
  }

  clear() {
    this.tracks = [];
    this.current = -1;
  }
}
