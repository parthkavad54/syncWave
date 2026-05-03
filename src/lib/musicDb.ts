import Dexie, { Table } from 'dexie';
import { Track } from './types';

export class MusicDatabase extends Dexie {
  tracks!: Table<Track & { blob?: Blob }>;

  constructor() {
    super('MusicDatabase');
    this.version(1).stores({
      tracks: 'id, name, artist, ownerId'
    });
  }
}

export const musicDb = new MusicDatabase();

export const saveTrackOffline = async (track: Track, blob?: Blob) => {
  await musicDb.tracks.put({ ...track, blob });
};

export const getOfflineTrack = async (id: string) => {
  return await musicDb.tracks.get(id);
};
