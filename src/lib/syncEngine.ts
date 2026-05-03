import { io, Socket } from "socket.io-client";

class SyncEngine {
  public socket: Socket;
  public offset: number = 0;
  public rtt: number = 0;
  private syncInterval: any;
  private offsetHistory: { offset: number; rtt: number }[] = [];

  constructor() {
    const socketUrl = import.meta.env.VITE_API_URL || "";

    this.socket = io(socketUrl, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 10,
      transports: ["websocket", "polling"],
    });

    this.startSync();
  }

  private startSync() {
    const doSync = () => {
      const t1 = Date.now();
      this.socket.emit("clock:ping", t1);
    };

    this.socket.on("clock:pong", ({ t1, t2, t3 }) => {
      const t4 = Date.now();
      const currentRTT = (t4 - t1) - (t3 - t2);
      const currentOffset = ((t2 - t1) + (t3 - t4)) / 2;

      this.offsetHistory.push({ offset: currentOffset, rtt: currentRTT });
      if (this.offsetHistory.length > 30) this.offsetHistory.shift();

      // Use the bottom 33% RTT samples (cleanest network paths)
      const sorted = [...this.offsetHistory].sort((a, b) => a.rtt - b.rtt);
      const best = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.33)));
      this.offset = best.reduce((sum, s) => sum + s.offset, 0) / best.length;
      this.rtt = currentRTT;
    });

    // Do 15 rapid pings on startup for faster convergence
    const runInitialSync = async () => {
      for (let i = 0; i < 15; i++) {
        doSync();
        await new Promise((r) => setTimeout(r, 100));
      }
    };

    runInitialSync();
    this.syncInterval = setInterval(doSync, 3000);
  }

  /** Server-corrected wall clock in ms */
  public getCorrectedTime(): number {
    return Date.now() + this.offset;
  }

  /**
   * Given a playbackState from the server, computes the exact position in seconds
   * that SHOULD be playing right now.
   */
  public getExpectedPosition(
    positionMs: number,
    timestampMs: number,
    playing: boolean
  ): number {
    if (!playing) return positionMs / 1000;
    const elapsed = Math.max(0, this.getCorrectedTime() - timestampMs);
    return (positionMs + elapsed) / 1000;
  }

  public destroy() {
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.socket.disconnect();
  }
}

export const syncEngine = new SyncEngine();
