import { Howl, Howler } from "howler";
import Dexie, { Table } from "dexie";
import { syncEngine } from "./syncEngine";

// ─── Track Cache (IndexedDB via Dexie) ────────────────────────────────────────
class TrackCache extends Dexie {
  tracks!: Table<{ id: string; blob: Blob; url: string }>;
  constructor() {
    super("SyncWaveCache");
    this.version(1).stores({ tracks: "id, url" });
  }
}
const db = new TrackCache();

// ─── Prefetch Cache: next track blob URLs ─────────────────────────────────────
const prefetchCache = new Map<string, string>(); // trackId → objectURL

// ─── AudioEngine ──────────────────────────────────────────────────────────────
class AudioEngine {
  private currentHowl: Howl | null = null;
  private currentTrackId: string | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private syncInterval: any = null;

  // ── Analyser for visualizer ────────────────────────────────────────────────
  private setupAnalyser() {
    if (this.analyser) return;
    const ctx = Howler.ctx;
    if (!ctx) return;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 128;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    try {
      Howler.masterGain.connect(this.analyser);
    } catch (e) {
      console.warn("Failed to connect analyser:", e);
    }
  }

  public getFrequencyData(): number[] {
    this.setupAnalyser();
    if (this.analyser && this.dataArray) {
      this.analyser.getByteFrequencyData(this.dataArray);
      return Array.from(this.dataArray);
    }
    return Array(64).fill(0);
  }

  // ── Blob loading & caching ─────────────────────────────────────────────────
  public async loadAndBuffer(trackId: string, url: string): Promise<string> {
    // Already prefetched?
    if (prefetchCache.has(trackId)) {
      return prefetchCache.get(trackId)!;
    }

    // Already in IndexedDB?
    const cached = await db.tracks.get(trackId);
    if (cached) {
      const objUrl = URL.createObjectURL(cached.blob);
      prefetchCache.set(trackId, objUrl);
      return objUrl;
    }

    try {
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error("Network response was not ok");
      const blob = await response.blob();
      await db.tracks.put({ id: trackId, blob, url });
      const objUrl = URL.createObjectURL(blob);
      prefetchCache.set(trackId, objUrl);
      return objUrl;
    } catch {
      return url; // silent fallback to direct URL
    }
  }

  /**
   * Pre-fetch a track into cache silently (used while current track is playing).
   * Safe to call multiple times — it no-ops if already cached.
   */
  public async prefetch(trackId: string, url: string): Promise<void> {
    if (prefetchCache.has(trackId)) return;
    const cached = await db.tracks.get(trackId);
    if (cached) {
      prefetchCache.set(trackId, URL.createObjectURL(cached.blob));
      return;
    }
    try {
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) return;
      const blob = await response.blob();
      await db.tracks.put({ id: trackId, blob, url });
      prefetchCache.set(trackId, URL.createObjectURL(blob));
      console.log(`[Prefetch] Cached: ${trackId}`);
    } catch {
      // Silent — prefetch is best-effort
    }
  }

  // ── Core play / pause / stop ───────────────────────────────────────────────
  /**
   * Play a track. If the track is already loaded, just seek + resume.
   * @param url      Blob URL or direct URL
   * @param trackId  Unique ID for the track
   * @param startAtSeconds  Where to begin playback (seconds)
   * @param onEnd    Called when track naturally ends
   * @param onError  Called on load/play error
   */
  public play(
    url: string,
    trackId: string,
    startAtSeconds: number = 0,
    onEnd?: () => void,
    onError?: (err: any) => void
  ) {
    // Already this track?
    if (this.currentTrackId === trackId && this.currentHowl) {
      if (!this.currentHowl.playing()) {
        this.currentHowl.seek(startAtSeconds);
        this.currentHowl.play();
      }
      return;
    }

    // Unload previous
    this._clearSyncLoop();
    if (this.currentHowl) {
      this.currentHowl.stop();
      this.currentHowl.unload();
      this.currentHowl = null;
    }

    this.currentTrackId = trackId;

    this.currentHowl = new Howl({
      src: [url],
      format: ["mp3", "wav", "ogg", "flac", "aac", "m4a"],
      html5: false, // Web Audio API — required for precision
      preload: true,
      onload: () => {
        // Seek to the correct start position once loaded
        this.currentHowl?.seek(startAtSeconds);
      },
      onplay: () => {
        this.setupAnalyser();
      },
      onloaderror: (_id, err) => {
        console.warn("Howler load error:", err, "URL:", url);
        onError?.(err);
      },
      onplayerror: (_id, err) => {
        console.warn("Howler play error:", err);
        // Unlock audio context and retry
        this.currentHowl?.once("unlock", () => this.currentHowl?.play());
        onError?.(err);
      },
      onend: () => {
        onEnd?.();
      },
    });

    this.currentHowl.play();
  }

  public pause() {
    this.currentHowl?.pause();
  }

  public resume() {
    if (this.currentHowl && !this.currentHowl.playing()) {
      this.currentHowl.play();
    }
  }

  public stop() {
    this._clearSyncLoop();
    this.currentHowl?.stop();
    this.currentHowl?.unload();
    this.currentHowl = null;
    this.currentTrackId = null;
  }

  public seek(positionSeconds: number) {
    this.currentHowl?.seek(positionSeconds);
  }

  public setRate(rate: number) {
    this.currentHowl?.rate(rate);
  }

  public getPosition(): number {
    return (this.currentHowl?.seek() as number) || 0;
  }

  public getDuration(): number {
    return (this.currentHowl?.duration() as number) || 0;
  }

  public get trackId() {
    return this.currentTrackId;
  }

  // ── Continuous drift correction ────────────────────────────────────────────
  /**
   * Start a continuous background loop that keeps local audio in sync
   * with the server's expected playback position.
   *
   * Algorithm:
   *  - Every 500ms compare local position with server's expected position
   *  - Drift < 80ms  → do nothing (acceptable jitter)
   *  - Drift 80–500ms → micro-rate adjust (±2%)
   *  - Drift > 500ms  → hard seek
   */
  public startSyncLoop(
    getServerPosition: () => number // returns expected position in seconds
  ) {
    this._clearSyncLoop();
    this.syncInterval = setInterval(() => {
      if (!this.currentHowl?.playing()) return;

      const localPos = this.getPosition();
      const serverPos = getServerPosition();
      const driftMs = (serverPos - localPos) * 1000;
      const absDrift = Math.abs(driftMs);

      if (absDrift > 500) {
        // Hard seek
        this.currentHowl?.seek(serverPos);
        this.currentHowl?.rate(1.0);
      } else if (absDrift > 80) {
        // Micro rate adjust
        this.currentHowl?.rate(driftMs > 0 ? 1.02 : 0.98);
      } else {
        // In sync — restore normal rate
        this.currentHowl?.rate(1.0);
      }
    }, 500);
  }

  public stopSyncLoop() {
    this._clearSyncLoop();
    this.currentHowl?.rate(1.0);
  }

  private _clearSyncLoop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Legacy single-call sync (used for initial seek on party:update).
   * Kept for compatibility.
   */
  public syncTo(targetPositionSeconds: number, driftMs: number) {
    if (!this.currentHowl) return;
    if (driftMs > 500) {
      this.currentHowl.seek(targetPositionSeconds);
      this.currentHowl.rate(1.0);
    } else if (driftMs > 80) {
      const local = this.currentHowl.seek() as number;
      this.currentHowl.rate(local < targetPositionSeconds ? 1.02 : 0.98);
    } else {
      this.currentHowl.rate(1.0);
    }
  }
}

export const audioEngine = new AudioEngine();
