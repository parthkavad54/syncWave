import { Howl, Howler } from "howler";
import Dexie, { Table } from "dexie";

// Database for track caching
class TrackCache extends Dexie {
  tracks!: Table<{ id: string; blob: Blob; url: string }>;

  constructor() {
    super("SyncWaveCache");
    this.version(1).stores({
      tracks: "id, url"
    });
  }
}

const db = new TrackCache();

class AudioEngine {
  private currentHowl: Howl | null = null;
  private currentTrackId: string | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;

  private setupAnalyser() {
    if (this.analyser) return;
    const ctx = Howler.ctx;
    if (!ctx) return;
    
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 128; // Smaller for smoother UI visualization
    const bufferLength = this.analyser.frequencyBinCount;
    this.dataArray = new Uint8Array(bufferLength);
    
    // Connect master gain to analyser
    try {
      Howler.masterGain.connect(this.analyser);
      // We don't need to connect analyser to destination because masterGain is already connected
      // and we just want to eavesdrop.
    } catch (e) {
      console.warn("Failed to connect analyser:", e);
    }
  }

  private ambientHowls: Map<string, Howl> = new Map();

  public playAmbient(id: string, url: string, volume: number = 0.5) {
    if (this.ambientHowls.has(id)) {
      const howl = this.ambientHowls.get(id)!;
      howl.volume(volume);
      if (!howl.playing()) howl.play();
      return;
    }

    const howl = new Howl({
      src: [url],
      loop: true,
      volume: volume,
      autoplay: true,
      html5: false, // Better for multiple simultaneous layers
    });

    this.ambientHowls.set(id, howl);
  }

  public stopAmbient(id: string) {
    const howl = this.ambientHowls.get(id);
    if (howl) {
      howl.fade(howl.volume(), 0, 1000);
      setTimeout(() => {
        howl.stop();
        howl.unload();
      }, 1100);
      this.ambientHowls.delete(id);
    }
  }

  public setAmbientVolume(id: string, volume: number) {
    this.ambientHowls.get(id)?.volume(volume);
  }

  public stopAllAmbient() {
    this.ambientHowls.forEach((howl, id) => {
      this.stopAmbient(id);
    });
  }

  public getFrequencyData(): number[] {
    this.setupAnalyser();
    if (this.analyser && this.dataArray) {
      this.analyser.getByteFrequencyData(this.dataArray);
      return Array.from(this.dataArray);
    }
    return Array(64).fill(0);
  }

  public async loadAndBuffer(trackId: string, url: string): Promise<string> {
    const cached = await db.tracks.get(trackId);
    if (cached) {
      return URL.createObjectURL(cached.blob);
    }

    try {
      // Use a CORS proxy for buffering to avoid "Failed to fetch" on external resources
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error("Network response was not ok");
      const blob = await response.blob();
      await db.tracks.put({ id: trackId, blob, url });
      return URL.createObjectURL(blob);
    } catch (e) {
      // Silent fallback to direct URL
      return url;
    }
  }

  public play(url: string, trackId: string, position: number = 0, onEnd?: () => void, onError?: (error: any) => void) {
    if (this.currentTrackId === trackId && this.currentHowl) {
      if (!this.currentHowl.playing()) {
        this.currentHowl.seek(position);
        this.currentHowl.play();
      }
      return;
    }

    if (this.currentHowl) {
      this.currentHowl.stop();
      this.currentHowl.unload();
    }

    this.currentHowl = new Howl({
      src: [url],
      format: ["mp3", "wav", "ogg", "flac"],
      html5: false, // MANDATORY for Web Audio API precision
      preload: true,
      onplay: () => {
        if (position > 0) this.currentHowl?.seek(position);
      },
      onloaderror: (id, error) => {
        console.warn("Howler load error:", error, "URL:", url);
        if (onError) onError(error);
      },
      onplayerror: (id, error) => {
        console.warn("Howler play error:", error);
        this.currentHowl?.once('unlock', () => this.currentHowl?.play());
        if (onError) onError(error);
      },
      onend: () => {
        if (onEnd) onEnd();
      }
    });

    this.currentTrackId = trackId;
    this.currentHowl.play();
  }

  public get trackId() {
    return this.currentTrackId;
  }

  public resume() {
    if (this.currentHowl && !this.currentHowl.playing()) {
      this.currentHowl.play();
    }
  }

  public pause() {
    this.currentHowl?.pause();
  }

  public stop() {
    this.currentHowl?.stop();
    this.currentTrackId = null;
  }

  public seek(position: number) {
    this.currentHowl?.seek(position);
  }

  public setRate(rate: number) {
    if (this.currentHowl) {
      this.currentHowl.rate(rate);
    }
  }

  public syncTo(targetPosition: number, drift: number) {
    if (!this.currentHowl) return;

    if (drift > 1000) {
      // Large drift: Hard seek
      this.currentHowl.seek(targetPosition);
      this.currentHowl.rate(1.0);
    } else if (drift > 50) {
      // Small drift: Adaptive rate
      // If we are behind, speed up. If ahead, slow down.
      const currentPos = this.currentHowl.seek() as number;
      if (currentPos < targetPosition) {
        this.currentHowl.rate(1.02); // 2% faster
      } else {
        this.currentHowl.rate(0.98); // 2% slower
      }
    } else {
      // In sync
      this.currentHowl.rate(1.0);
    }
  }

  public getPosition() {
    return this.currentHowl?.seek() as number || 0;
  }

  public getDuration() {
    return this.currentHowl?.duration() as number || 0;
  }
}

export const audioEngine = new AudioEngine();
