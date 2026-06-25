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
  startedAtServerTime: number; // Anchor point on the server timeline
  pausedPosition?: number;     // Absolute position (ms) if currently paused
  playbackRate?: number;
}

export interface Listener {
  id: string; // Socket ID
  userId: string; // Persistent ID from localStorage
  name: string;
  device_info: string;
  isMuted?: boolean;
}

export interface ChatMessage {
  id: string;
  userId: string;
  name: string;
  text: string;
  timestamp: number;
}

export interface Party {
  code: string;
  hostId: string | null;
  hostUserId?: string;
  hostName: string | null;
  listeners: Listener[];
  queue: Track[];
  history?: Track[];
  currentTrack: Track | null;
  playbackState: PlaybackState;
  bannedIds: string[];
  ambientVibe?: {
    id: string;
    volume: number;
  } | null;
  visualizerMode?: string;
  chatMessages?: ChatMessage[];
}

export interface SyncData {
  track_id: string;
  position_ms: number;
  server_time: number;
}
