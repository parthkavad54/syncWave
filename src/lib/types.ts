export interface Track {
  id: string;
  url: string;
  name: string;
  artist: string;
  album?: string;
  genre?: string;
  duration: number;
  coverArt?: string | null;
  ownerId?: string;
  type?: 'direct' | 'youtube';
}

export interface PlaybackState {
  playing: boolean;
  position: number;
  timestamp: number;
  scheduledStartTime?: number | null;
}

export interface Listener {
  id: string; // Socket ID
  userId: string; // Persistent ID from localStorage
  name: string;
  device_info: string;
  isMuted?: boolean;
}

export interface Party {
  code: string;
  hostId: string | null;
  hostName: string | null;
  listeners: Listener[];
  queue: Track[];
  currentTrack: Track | null;
  playbackState: PlaybackState;
  bannedIds: string[];
  ambientVibe?: {
    id: string;
    volume: number;
  } | null;
}

export interface SyncData {
  track_id: string;
  position_ms: number;
  server_time: number;
}
