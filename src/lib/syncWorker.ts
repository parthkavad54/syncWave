import { io, Socket } from "socket.io-client";
import parser from "socket.io-msgpack-parser";

let socket: Socket | null = null;
let syncInterval: any = null;

// Clock Sync State
let currentOffset = 0;
let currentRTT = 0;
let offsetHistory: { offset: number; rtt: number }[] = [];

self.onmessage = (e) => {
  const { type, payload } = e.data;

  if (type === "INIT") {
    if (socket) return;
    
    // Dedicated socket connection for Clock Sync, running in Web Worker
    socket = io(payload.socketUrl, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 10,
      transports: ["websocket", "polling"],
      parser,
    });

    const doSync = () => {
      const t1 = Date.now();
      socket?.emit("clock:ping", t1);
    };

    socket.on("clock:pong", ({ t1, t2, t3 }: { t1: number; t2: number; t3: number }) => {
      const t4 = Date.now();
      const rtt = (t4 - t1) - (t3 - t2);
      const offset = ((t2 - t1) + (t3 - t4)) / 2;

      offsetHistory.push({ offset, rtt });
      if (offsetHistory.length > 50) offsetHistory.shift();

      // Use the bottom 33% RTT samples (cleanest network paths)
      const sorted = [...offsetHistory].sort((a, b) => a.rtt - b.rtt);
      const best = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.33)));
      
      const newOffset = best.reduce((sum, s) => sum + s.offset, 0) / best.length;
      
      // Exponential Moving Average
      if (currentOffset === 0) {
        currentOffset = newOffset;
      } else {
        currentOffset = currentOffset * 0.8 + newOffset * 0.2;
      }
      
      currentRTT = rtt;

      self.postMessage({
        type: "SYNC_UPDATE",
        offset: currentOffset,
        rtt: currentRTT,
      });
    });

    // Run initial fast sync
    const runInitialSync = async () => {
      for (let i = 0; i < 15; i++) {
        doSync();
        await new Promise((r) => setTimeout(r, 100));
      }
    };

    runInitialSync();

    // High-Frequency PING/PONG (1000ms instead of 3000ms)
    syncInterval = setInterval(doSync, 1000);
  }

  if (type === "DESTROY") {
    if (syncInterval) clearInterval(syncInterval);
    if (socket) socket.disconnect();
  }
};
