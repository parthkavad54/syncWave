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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

async function startServer() {
  const app = express();
  app.use(cors());
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Middleware
  app.use(express.json());
  app.use("/uploads", express.static(uploadsDir));

  // Memory store for parties
  // In a real app, this would be Redis
  const parties = new Map<string, any>();

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
  app.post("/api/session/create", (req, res) => {
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
        lastUpdated: Date.now()
      }
    };
    parties.set(code, party);
    res.json({ code });
  });

  app.get("/api/session/:code", (req, res) => {
    const party = parties.get(req.params.code);
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

  // Handle Spotify and other platform URLs by converting to YouTube
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
        
        // Extract artist and track from URL
        const parts = scUrl.split("/");
        const artist = parts[parts.length - 2];
        const track = parts[parts.length - 1];
        searchQuery = `${track} ${artist}`.replace(/-/g, " ");
      } else if (platform === "youtube") {
        // Already YouTube, just search directly
        searchQuery = url;
      } else {
        // Treat as generic search query
        searchQuery = url;
      }

      // Search on YouTube for the track
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

    // Clock sync (NTP-like)
    socket.on("clock:ping", (t1) => {
      socket.emit("clock:pong", {
        t1,
        t2: Date.now(),
        t3: Date.now()
      });
    });

    socket.on("party:create", ({ host_id, host_name }, callback) => {
      const code = nanoid(6).toUpperCase();
      const party = {
        code,
        hostId: socket.id,
        hostName: host_name,
        listeners: [{ id: socket.id, userId: host_id, name: host_name, device_info: "Host", isMuted: false }],
        queue: [],
        currentTrack: null,
        playbackState: {
          playing: false,
          position: 0,
          timestamp: Date.now()
        },
        bannedIds: [],
        ambientVibe: null
      };
      parties.set(code, party);
      socket.join(code);
      callback(code);
      io.to(code).emit("party:update", party);
    });

    socket.on("party:join", ({ code, listener_id, listener_name }, callback) => {
      const party = parties.get(code.toUpperCase());
      if (!party) {
        callback({ success: false, error: "Session not found" });
        return;
      }

      if (party.bannedIds.includes(listener_id)) {
        callback({ success: false, error: "You are banned from this session" });
        return;
      }

      socket.join(code.toUpperCase());
      const newListener = { id: socket.id, userId: listener_id, name: listener_name, device_info: "Listener", isMuted: false };
      party.listeners.push(newListener);
      
      callback({ success: true });
      io.to(code.toUpperCase()).emit("party:update", party);
    });

    socket.on("party:leave", ({ code }) => {
      const party = parties.get(code);
      if (party) {
        party.listeners = party.listeners.filter((l: any) => l.id !== socket.id);
        socket.leave(code);
        if (party.listeners.length === 0) {
          parties.delete(code);
        } else {
          if (party.hostId === socket.id) {
            party.hostId = party.listeners[0].id;
            party.hostName = party.listeners[0].name;
          }
          io.to(code).emit("party:update", party);
        }
      }
    });

    socket.on("party:kick", ({ code, listener_id }) => {
      const party = parties.get(code);
      if (party && party.hostId === socket.id && listener_id !== socket.id) {
        party.listeners = party.listeners.filter((l: any) => l.id !== listener_id);
        io.to(listener_id).emit("party:kicked");
        io.to(code).emit("party:update", party);
      }
    });

    socket.on("party:mute", ({ code, listener_id, muted }) => {
      const party = parties.get(code);
      if (party && party.hostId === socket.id) {
        const listener = party.listeners.find((l: any) => l.id === listener_id);
        if (listener) {
          listener.isMuted = muted;
          io.to(code).emit("party:update", party);
        }
      }
    });

    socket.on("party:ban", ({ code, listener_id }) => {
      const party = parties.get(code);
      if (party && party.hostId === socket.id && listener_id !== socket.id) {
        const targetListener = party.listeners.find((l: any) => l.id === listener_id);
        if (targetListener) {
          party.bannedIds.push(targetListener.userId);
        }
        party.listeners = party.listeners.filter((l: any) => l.id !== listener_id);
        io.to(listener_id).emit("party:banned");
        io.to(code).emit("party:update", party);
      }
    });

    socket.on("party:update-vibe", ({ code, vibe }) => {
      const party = parties.get(code);
      if (party && (party.hostId === socket.id)) {
        party.ambientVibe = vibe;
        io.to(code).emit("party:update", party);
      }
    });

    socket.on("sync:play", ({ code, track_id, position_ms }) => {
      const party = parties.get(code);
      if (party && party.hostId === socket.id) {
        // Find track in queue or current
        let track = party.currentTrack?.id === track_id ? party.currentTrack : party.queue.find(t => t.id === track_id);
        
        if (track) {
          // Play track but KEEP it in queue for replay (don't remove from queue)
          party.currentTrack = track;
          
          const scheduledDelay = 1500; // 1.5s delay for buffering and hardware prep
          party.playbackState = {
            playing: true,
            position: position_ms,
            timestamp: Date.now() + scheduledDelay,
            scheduledStartTime: Date.now() + scheduledDelay
          };
          io.to(code).emit("party:update", party);
        }
      }
    });

    socket.on("sync:pause", ({ code }) => {
      const party = parties.get(code);
      if (party && party.hostId === socket.id) {
        const now = Date.now();
        const elapsed = party.playbackState.playing ? Math.max(0, now - party.playbackState.timestamp) : 0;
        party.playbackState = {
          playing: false,
          position: party.playbackState.position + elapsed,
          timestamp: now,
          scheduledStartTime: null
        };
        io.to(code).emit("party:update", party);
      }
    });

    socket.on("sync:seek", ({ code, position_ms }) => {
      const party = parties.get(code);
      if (party && party.hostId === socket.id) {
        const scheduledDelay = 500; // Shorter delay for seeks
        party.playbackState.position = position_ms;
        party.playbackState.timestamp = Date.now() + scheduledDelay;
        party.playbackState.scheduledStartTime = Date.now() + scheduledDelay;
        io.to(code).emit("party:update", party);
      }
    });

    socket.on("queue:update", ({ code, queue }) => {
      const party = parties.get(code);
      if (party && party.hostId === socket.id) {
        party.queue = queue;
        io.to(code).emit("party:update", party);
      }
    });

    socket.on("client:reaction", ({ code, type }) => {
      io.to(code).emit("sync:reaction", { type });
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
      for (const [code, party] of parties.entries()) {
        const index = party.listeners.findIndex((l: any) => l.id === socket.id);
        if (index !== -1) {
          party.listeners.splice(index, 1);
          if (party.listeners.length === 0) {
            parties.delete(code);
          } else {
            if (party.hostId === socket.id) {
              party.hostId = party.listeners[0].id;
              party.hostName = party.listeners[0].name;
            }
            io.to(code).emit("party:update", party);
          }
        }
      }
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
