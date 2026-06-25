import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";
import { nanoid } from "nanoid";
import Redis from "ioredis";
import RedisMock from "ioredis-mock";
import parser from "socket.io-msgpack-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const redis = process.env.REDIS_URL 
  ? new Redis(process.env.REDIS_URL) 
  : new RedisMock();

async function getParty(code: string) {
  const data = await redis.hgetall(`syncwave:room:${code}`);
  if (!data || !data.hostId) return null;
  
  const queue = await redis.lrange(`syncwave:room:${code}:queue`, 0, -1);
  const history = await redis.lrange(`syncwave:room:${code}:history`, 0, -1);
  const chatMessages = await redis.lrange(`syncwave:room:${code}:chat`, 0, -1);
  
  return {
    code,
    hostId: data.hostId,
    hostUserId: data.hostUserId,
    hostName: data.hostName || "Host",
    currentTrack: data.currentTrack ? JSON.parse(data.currentTrack) : null,
    playbackState: {
      playing: data.playing === "true",
      startedAtServerTime: parseInt(data.startedAtServerTime || "0", 10),
      pausedPosition: parseInt(data.pausedPosition || "0", 10),
      playbackRate: parseFloat(data.playbackRate || "1")
    },
    queue: queue.map(t => JSON.parse(t)),
    history: history.map(t => JSON.parse(t)),
    chatMessages: chatMessages.map(m => JSON.parse(m)),
    listeners: data.listeners ? JSON.parse(data.listeners) : [],
    bannedIds: data.bannedIds ? JSON.parse(data.bannedIds) : [],
    ambientVibe: data.ambientVibe ? JSON.parse(data.ambientVibe) : null,
    visualizerMode: data.visualizerMode || "particles"
  };
}

async function setParty(code: string, party: any) {
  await redis.hset(`syncwave:room:${code}`, {
    hostId: party.hostId || "",
    hostUserId: party.hostUserId || "",
    hostName: party.hostName || "",
    currentTrack: party.currentTrack ? JSON.stringify(party.currentTrack) : "",
    playing: party.playbackState.playing ? "true" : "false",
    startedAtServerTime: party.playbackState.startedAtServerTime.toString(),
    pausedPosition: (party.playbackState.pausedPosition || 0).toString(),
    playbackRate: (party.playbackState.playbackRate || 1).toString(),
    listeners: JSON.stringify(party.listeners || []),
    bannedIds: JSON.stringify(party.bannedIds || []),
    ambientVibe: party.ambientVibe ? JSON.stringify(party.ambientVibe) : "",
    visualizerMode: party.visualizerMode || "particles"
  });
  
  // Update queue
  const queueKey = `syncwave:room:${code}:queue`;
  await redis.del(queueKey);
  if (party.queue && party.queue.length > 0) {
    await redis.rpush(queueKey, ...party.queue.map((t: any) => JSON.stringify(t)));
  }

  // Update history
  const historyKey = `syncwave:room:${code}:history`;
  await redis.del(historyKey);
  if (party.history && party.history.length > 0) {
    await redis.rpush(historyKey, ...party.history.map((t: any) => JSON.stringify(t)));
  }

  // Update chat
  const chatKey = `syncwave:room:${code}:chat`;
  await redis.del(chatKey);
  if (party.chatMessages && party.chatMessages.length > 0) {
    await redis.rpush(chatKey, ...party.chatMessages.map((m: any) => JSON.stringify(m)));
  }
}

async function deleteParty(code: string) {
  await redis.del(`syncwave:room:${code}`);
  await redis.del(`syncwave:room:${code}:queue`);
  await redis.del(`syncwave:room:${code}:history`);
  await redis.del(`syncwave:room:${code}:chat`);
}

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);
  
  // Determine allowed origins based on environment
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173'
  ];
  
  // Add production domain if provided
  if (process.env.APP_URL) {
    allowedOrigins.push(process.env.APP_URL);
  }
  
  // Add Vercel domains
  if (process.env.VERCEL_URL) {
    allowedOrigins.push(`https://${process.env.VERCEL_URL}`);
  }
  
  app.use(cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }));
  
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    transports: ['websocket', 'polling'],
    parser,
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  // Middleware
  app.use(express.json());
  app.use("/uploads", express.static(uploadsDir));

  // Serve Vite-built frontend in production
  const distPath = path.join(__dirname, "dist");
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
  }

  // Multer setup for music uploads
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${nanoid()}${ext}`);
    }
  });

  const upload = multer({ 
    storage,
    limits: {
      fileSize: 15 * 1024 * 1024 // 15MB limit
    },
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith("audio/")) {
        cb(null, true);
      } else {
        cb(new Error("Invalid file type. Please upload an audio file."));
      }
    }
  });

  // API Routes
  app.post("/api/session/create", async (req, res) => {
    const code = nanoid(6).toUpperCase();
    const party = {
      code,
      hostId: null, // Set on socket connection
      listeners: [],
      queue: [],
      currentTrack: null,
      playbackState: {
        playing: false,
        position: 0,
        timestamp: Date.now()
      }
    };
    await setParty(code, party);
    res.json({ code });
  });

  app.get("/api/session/:code", async (req, res) => {
    const party = await getParty(req.params.code);
    if (!party) return res.status(404).json({ error: "Session not found" });
    res.json(party);
  });

  // Helper: Parse Spotify URL and extract track ID
  function parseSpotifyUrl(url: string): string | null {
    const patterns = [
      /spotify\.com\/track\/([a-zA-Z0-9]+)/,
      /open\.spotify\.com\/track\/([a-zA-Z0-9]+)/,
      /^([a-zA-Z0-9]+)$/ // Direct track ID (URI format)
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  // Helper: Parse SoundCloud URL
  function parseSoundCloudUrl(url: string): string | null {
    const match = url.match(/soundcloud\.com\/[\w-]+\/[\w-]+/);
    return match ? match[0] : null;
  }

  // Helper: Get Spotify track metadata using public API
  async function getSpotifyTrackMetadata(trackId: string): Promise<{ title: string; artist: string } | null> {
    try {
      const response = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`);
      if (!response.ok) return null;
      const data: any = await response.json();
      return {
        title: data.name,
        artist: data.artists.map((a: any) => a.name).join(", ")
      };
    } catch (e) {
      console.warn("Failed to fetch Spotify metadata:", e);
      return null;
    }
  }

  // Helper: Detect platform from URL
  function detectPlatform(url: string): "spotify" | "soundcloud" | "youtube" | "generic" | null {
    if (url.includes("spotify.com") || url.includes("open.spotify")) return "spotify";
    if (url.includes("soundcloud.com")) return "soundcloud";
    if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
    return null;
  }

  // YouTube API Helper
  function parseDuration(duration: string): number {
    const matches = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!matches) return 0;
    const hours = parseInt(matches[1] || '0');
    const minutes = parseInt(matches[2] || '0');
    const seconds = parseInt(matches[3] || '0');
    return hours * 3600 + minutes * 60 + seconds;
  }

  app.get("/api/youtube/search", async (req, res) => {
    const query = req.query.q as string;
    if (!query) return res.status(400).json({ error: "Query is required" });
    
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      console.error("YOUTUBE_API_KEY is missing in environment");
      return res.status(500).json({ error: "YouTube API key not configured. Add YOUTUBE_API_KEY to your .env file." });
    }

    try {
      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&videoCategoryId=10&maxResults=10&key=${apiKey}`;
      const searchRes = await fetch(searchUrl);
      const searchData: any = await searchRes.json();

      if (searchData.error) throw new Error(searchData.error.message);

      const videoIds = searchData.items.map((item: any) => item.id.videoId);
      if (videoIds.length === 0) return res.json([]);

      const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoIds.join(',')}&key=${apiKey}`;
      const detailsRes = await fetch(detailsUrl);
      const detailsData: any = await detailsRes.json();

      const results = detailsData.items.map((item: any) => ({
        id: item.id,
        title: item.snippet.title,
        artist: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.default?.url,
        duration: parseDuration(item.contentDetails.duration),
        type: 'youtube'
      }));

      res.json(results);
    } catch (error: any) {
      console.error("YouTube Search Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/music/resolve-url", async (req, res) => {
    const url = req.query.url as string;
    if (!url) return res.status(400).json({ error: "URL is required" });

    try {
      const platform = detectPlatform(url);
      let searchQuery = "";

      if (platform === "spotify") {
        const spotifyId = parseSpotifyUrl(url);
        if (!spotifyId) return res.status(400).json({ error: "Invalid Spotify URL" });
        
        const metadata = await getSpotifyTrackMetadata(spotifyId);
        if (!metadata) return res.status(400).json({ error: "Could not fetch Spotify track metadata" });
        
        searchQuery = `${metadata.title} ${metadata.artist}`;
      } else if (platform === "soundcloud") {
        const scUrl = parseSoundCloudUrl(url);
        if (!scUrl) return res.status(400).json({ error: "Invalid SoundCloud URL" });
        
        const parts = scUrl.split("/");
        const artist = parts[parts.length - 2];
        const track = parts[parts.length - 1];
        searchQuery = `${track} ${artist}`.replace(/-/g, " ");
      } else if (platform === "youtube") {
        searchQuery = url;
      } else {
        searchQuery = url;
      }

      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "YouTube API key not configured" });
      }

      const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(searchQuery)}&type=video&videoCategoryId=10&maxResults=5&key=${apiKey}`;
      const searchRes = await fetch(searchUrl);
      const searchData: any = await searchRes.json();

      if (searchData.error) throw new Error(searchData.error.message);

      const videoIds = searchData.items.map((item: any) => item.id.videoId);
      if (videoIds.length === 0) return res.json([]);

      const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoIds.join(',')}&key=${apiKey}`;
      const detailsRes = await fetch(detailsUrl);
      const detailsData: any = await detailsRes.json();

      const results = detailsData.items.map((item: any) => ({
        id: item.id,
        title: item.snippet.title,
        artist: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.default?.url,
        duration: parseDuration(item.contentDetails.duration),
        type: 'youtube',
        source: platform || 'unknown'
      }));

      res.json(results);
    } catch (error: any) {
      console.error("URL Resolution Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/music/upload", (req: any, res) => {
    upload.single("file")(req, res, (err: any) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({ error: "File is too large. Max size is 15MB." });
        }
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      } else if (err) {
        return res.status(400).json({ error: err.message });
      }

      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const track = {
        id: nanoid(),
        url: `/uploads/${req.file.filename}`,
        name: req.body.name || req.file.originalname,
        artist: req.body.artist || "Unknown Artist",
        duration: parseFloat(req.body.duration) || 0,
        coverArt: req.body.coverArt || null
      };
      res.json(track);
    });
  });

  // Socket.IO Logic
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("clock:ping", (t1) => {
      socket.emit("clock:pong", {
        t1,
        t2: Date.now(),
        t3: Date.now()
      });
    });

    socket.on("presence:heartbeat", async () => {
      // Set presence in Redis with 30s TTL
      await redis.set(`syncwave:presence:${socket.id}`, "active", "EX", 30);
    });

    socket.on("party:create", async ({ host_id, host_name }, callback) => {
      const code = nanoid(6).toUpperCase();
      const party = {
        code,
        hostId: socket.id,
        hostUserId: host_id,
        hostName: host_name,
        listeners: [{ id: socket.id, userId: host_id, name: host_name, device_info: "Host", isMuted: false }],
        queue: [],
        history: [],
        chatMessages: [],
        visualizerMode: "particles",
        currentTrack: null,
        playbackState: {
          playing: false,
          startedAtServerTime: Date.now(),
          pausedPosition: 0,
          playbackRate: 1
        },
        bannedIds: [],
        ambientVibe: null
      };
      await setParty(code, party);
      socket.join(code);
      callback(code);
      io.to(code).emit("party:update", party);
    });

    socket.on("party:join", async ({ code, listener_id, listener_name, isHostReclaim }, callback) => {
      if (typeof callback !== "function") return;
      if (!code || typeof code !== "string") {
        callback({ success: false, error: "Invalid session code." });
        return;
      }

      const upperCode = code.trim().toUpperCase();
      const party = await getParty(upperCode);
      if (!party) {
        callback({ success: false, error: `Session "${upperCode}" not found. The host may have ended the session.` });
        return;
      }

      if (party.bannedIds.includes(listener_id)) {
        callback({ success: false, error: "You are banned from this session." });
        return;
      }

      socket.join(upperCode);
      // Deduplicate: remove any stale entry with same userId OR same socketId
      party.listeners = party.listeners.filter(
        (l: any) => l.userId !== listener_id && l.id !== socket.id
      );
      const displayName = (listener_name || "").trim() || `Guest ${party.listeners.length + 1}`;
      const newListener = { id: socket.id, userId: listener_id, name: displayName, device_info: "Listener", isMuted: false };
      party.listeners.push(newListener);
      
      if (isHostReclaim && party.hostUserId === listener_id) {
        party.hostId = socket.id;
      }

      await setParty(upperCode, party);
      callback({ success: true });
      io.to(upperCode).emit("party:update", party);
    });

    socket.on("party:leave", async ({ code }) => {
      const party = await getParty(code);
      if (party) {
        party.listeners = party.listeners.filter((l: any) => l.id !== socket.id);
        socket.leave(code);
        if (party.listeners.length === 0) {
          await deleteParty(code);
        } else {
          if (party.hostId === socket.id) {
            party.hostId = party.listeners[0].id;
            party.hostName = party.listeners[0].name;
          }
          await setParty(code, party);
          io.to(code).emit("party:update", party);
        }
      }
    });

    socket.on("party:kick", async ({ code, listener_id }) => {
      const party = await getParty(code);
      if (party && party.hostId === socket.id && listener_id !== socket.id) {
        party.listeners = party.listeners.filter((l: any) => l.id !== listener_id);
        await setParty(code, party);
        io.to(listener_id).emit("party:kicked");
        io.to(code).emit("party:update", party);
      }
    });

    socket.on("party:mute", async ({ code, listener_id, muted }) => {
      const party = await getParty(code);
      if (party && party.hostId === socket.id) {
        const listener = party.listeners.find((l: any) => l.id === listener_id);
        if (listener) {
          listener.isMuted = muted;
          await setParty(code, party);
          io.to(code).emit("party:update", party);
        }
      }
    });

    socket.on("party:ban", async ({ code, listener_id }) => {
      const party = await getParty(code);
      if (party && party.hostId === socket.id && listener_id !== socket.id) {
        const targetListener = party.listeners.find((l: any) => l.id === listener_id);
        if (targetListener) {
          party.bannedIds.push(targetListener.userId);
        }
        party.listeners = party.listeners.filter((l: any) => l.id !== listener_id);
        await setParty(code, party);
        io.to(listener_id).emit("party:banned");
        io.to(code).emit("party:update", party);
      }
    });

    socket.on("party:update-vibe", async ({ code, vibe }) => {
      const party = await getParty(code);
      if (party && (party.hostId === socket.id)) {
        party.ambientVibe = vibe;
        await setParty(code, party);
        io.to(code).emit("party:update", party);
      }
    });

    socket.on("sync:play", async ({ code, track_id, position_ms }) => {
      const party = await getParty(code);
      if (party && party.hostId === socket.id) {
        let track = party.currentTrack?.id === track_id ? party.currentTrack : party.queue.find((t: any) => t.id === track_id);
        
        if (track) {
          // If the track is changing, push the old one to history
          if (party.currentTrack && party.currentTrack.id !== track.id) {
            party.history = party.history || [];
            party.history.push(party.currentTrack);
          }

          party.currentTrack = track;
          const scheduledDelay = 1500;
          const targetTime = Date.now() + scheduledDelay;
          party.playbackState = {
            playing: true,
            startedAtServerTime: targetTime - position_ms,
            pausedPosition: 0,
            playbackRate: 1
          };
          await setParty(code, party);
          io.to(code).emit("party:update", party);
        }
      }
    });

    socket.on("sync:pause", async ({ code }) => {
      const party = await getParty(code);
      if (party && party.hostId === socket.id) {
        const now = Date.now();
        let pausedPos = party.playbackState.pausedPosition || 0;
        if (party.playbackState.playing) {
          pausedPos = now - party.playbackState.startedAtServerTime;
        }
        party.playbackState = {
          playing: false,
          startedAtServerTime: party.playbackState.startedAtServerTime,
          pausedPosition: pausedPos,
          playbackRate: 1
        };
        await setParty(code, party);
        io.to(code).emit("party:update", party);
      }
    });

    socket.on("sync:seek", async ({ code, position_ms }) => {
      const party = await getParty(code);
      if (party && party.hostId === socket.id) {
        const scheduledDelay = 500; // Shorter delay for seeks
        const targetTime = Date.now() + scheduledDelay;
        if (party.playbackState.playing) {
          party.playbackState.startedAtServerTime = targetTime - position_ms;
        } else {
          party.playbackState.pausedPosition = position_ms;
        }
        await setParty(code, party);
        io.to(code).emit("party:update", party);
      }
    });

    socket.on("queue:update", async ({ code, queue }) => {
      const party = await getParty(code);
      if (party && party.hostId === socket.id) {
        party.queue = queue;
        await setParty(code, party);
        io.to(code).emit("party:update", party);
      }
    });

    socket.on("client:reaction", ({ code, type }) => {
      io.to(code).emit("sync:reaction", { type });
    });

    socket.on("chat:send", async ({ code, message }) => {
      const party = await getParty(code);
      if (party) {
        party.chatMessages = party.chatMessages || [];
        party.chatMessages.push(message);
        if (party.chatMessages.length > 50) {
          party.chatMessages.shift(); // keep last 50 messages
        }
        await setParty(code, party);
        io.to(code).emit("chat:receive", message);
      }
    });

    socket.on("party:update-visualizer", async ({ code, mode }) => {
      const party = await getParty(code);
      if (party && party.hostId === socket.id) {
        party.visualizerMode = mode;
        await setParty(code, party);
        io.to(code).emit("party:update", party);
      }
    });

    socket.on("disconnecting", async () => {
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          const party = await getParty(room);
          if (party) {
            const index = party.listeners.findIndex((l: any) => l.id === socket.id);
            if (index !== -1) {
              party.listeners.splice(index, 1);
              if (party.listeners.length === 0) {
                await deleteParty(room);
              } else {
                if (party.hostId === socket.id) {
                  party.hostId = party.listeners[0].id;
                  party.hostName = party.listeners[0].name;
                }
                await setParty(room, party);
                io.to(room).emit("party:update", party);
              }
            }
          }
        }
      }
    });

    socket.on("disconnect", async () => {
      console.log("Client disconnected:", socket.id);
      await redis.del(`syncwave:presence:${socket.id}`);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
