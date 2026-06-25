import { io, Socket } from "socket.io-client";
import parser from "socket.io-msgpack-parser";

class SyncEngine {
  public socket: Socket;
  public offset: number = 0;
  public rtt: number = 0;
  private worker: Worker | null = null;

  constructor() {
    const socketUrl = import.meta.env.VITE_API_URL || "";

    // Main thread socket for UI and Party events (with msgpack)
    this.socket = io(socketUrl, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 10,
      transports: ["websocket", "polling"],
      parser,
    });

    this.startWorkerSync(socketUrl);
  }

  private startWorkerSync(socketUrl: string) {
    this.worker = new Worker(new URL('./syncWorker.ts', import.meta.url), { type: 'module' });
    
    // Provide absolute URL since import.meta.env.VITE_API_URL could be relative (e.g. "")
    const absoluteUrl = socketUrl || window.location.origin;

    this.worker.postMessage({ type: "INIT", payload: { socketUrl: absoluteUrl } });

    this.worker.onmessage = (e) => {
      const { type, offset, rtt } = e.data;
      if (type === "SYNC_UPDATE") {
        this.offset = offset;
        this.rtt = rtt;
      }
    };
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
    startedAtServerTime: number,
    pausedPosition: number | undefined,
    playing: boolean
  ): number {
    if (!playing) return (pausedPosition || 0) / 1000;
    return (this.getCorrectedTime() - startedAtServerTime) / 1000;
  }

  public destroy() {
    if (this.worker) {
      this.worker.postMessage({ type: "DESTROY" });
      this.worker.terminate();
    }
    this.socket.disconnect();
  }
}

export const syncEngine = new SyncEngine();
