import { io, Socket } from "socket.io-client";

class SyncEngine {
  public socket: Socket;
  public offset: number = 0;
  public rtt: number = 0;
  private syncInterval: any;
  private offsetHistory: { offset: number; rtt: number }[] = [];

  constructor() {
    this.socket = io();
    this.startSync();
  }

  private startSync() {
    const doSync = () => {
      const t1 = Date.now();
      this.socket.emit("clock:ping", t1);
    };

    this.socket.on("clock:pong", ({ t1, t2, t3 }) => {
      const t4 = Date.now();
      // NTP formula: Offset = ((T2 - T1) + (T3 - T4)) / 2
      // RTT = (T4 - T1) - (T3 - T2)
      const currentRTT = (t4 - t1) - (t3 - t2);
      const currentOffset = ((t2 - t1) + (t3 - t4)) / 2;

      // Filter: We only care about low-jitter samples
      this.offsetHistory.push({ offset: currentOffset, rtt: currentRTT });
      
      if (this.offsetHistory.length > 20) this.offsetHistory.shift();

      // Find the samples with RTT in the bottom 25th percentile (the "cleanest" network paths)
      const sortedByRTT = [...this.offsetHistory].sort((a, b) => a.rtt - b.rtt);
      const bestSamples = sortedByRTT.slice(0, Math.max(1, Math.floor(sortedByRTT.length * 0.25)));
      
      this.offset = bestSamples.reduce((sum, s) => sum + s.offset, 0) / bestSamples.length;
      this.rtt = currentRTT;
    });

    const runInitialSync = async () => {
      for (let i = 0; i < 10; i++) {
        doSync();
        await new Promise(r => setTimeout(r, 200));
      }
    };

    runInitialSync();
    this.syncInterval = setInterval(doSync, 5000); // Stable tracking every 5s
  }

  public getCorrectedTime() {
    return Date.now() + this.offset;
  }

  public destroy() {
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.socket.disconnect();
  }
}

export const syncEngine = new SyncEngine();
