import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence, Reorder } from "motion/react";
import { Virtuoso, VirtuosoGrid } from "react-virtuoso";
import { 
  Play, Pause, SkipForward, SkipBack,
  Users, Music, Share2, Plus, LogOut, 
  Upload, QrCode as QrCodeIcon, Headphones,
  Zap, GripVertical,
  Mic, MicOff, UserMinus, Ban,
  Search, Loader2, Trash2, Signal
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  defaultDropAnimationSideEffects,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import ThreeBackground from "./components/ThreeBackground";
import { syncEngine } from "./lib/syncEngine";
import { audioEngine } from "./lib/audioEngine";
import { Party, Track, PlaybackState } from "./lib/types";
import { musicDb, saveTrackOffline, deleteTrackOffline } from "./lib/musicDb";
import { QRCodeSVG } from "qrcode.react";
import { GoogleGenAI, Type } from "@google/genai";
import { nanoid } from "nanoid";
import YouTube from "react-youtube";

// Ambient Atmosphere removed

const SyncStats = () => {
  const [stats, setStats] = useState({ offset: 0, rtt: 0 });

  useEffect(() => {
    const interval = setInterval(() => {
      setStats({ offset: syncEngine.offset, rtt: syncEngine.rtt });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-3 px-3 py-1 bg-black/20 rounded-full border border-white/5 backdrop-blur-sm">
      <div className="flex items-center gap-1.5">
        <Zap size={10} className={stats.rtt < 100 ? "text-green-400" : "text-yellow-400"} />
        <span className="text-[10px] font-mono text-white/60">{stats.rtt.toFixed(0)}ms</span>
      </div>
      <div className="w-px h-2 bg-white/10" />
      <div className="flex items-center gap-1.5">
        <Headphones size={10} className="text-party-violet" />
        <span className="text-[10px] font-mono text-white/60">{stats.offset > 0 ? "+" : ""}{stats.offset.toFixed(1)}ms</span>
      </div>
    </div>
  );
};

type View = "landing" | "host" | "listener" | "join" | "library";

// --- HELPERS ---

// --- ANIMATION VARIANTS ---
const viewVariants: any = {
  initial: { opacity: 0, y: 20, scale: 0.98 },
  animate: { 
    opacity: 1, 
    y: 0, 
    scale: 1,
    transition: { 
      duration: 0.4, 
      ease: "circOut",
      staggerChildren: 0.05,
      delayChildren: 0.1
    } 
  },
  exit: { 
    opacity: 0, 
    y: -20, 
    scale: 1.02,
    transition: { duration: 0.3, ease: "easeInOut" } 
  }
};

const staggerContainer: any = {
  animate: {
    transition: {
      staggerChildren: 0.05
    }
  }
};

const staggerItem: any = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, scale: 0.95 }
};

// --- SKELETON COMPONENTS ---
const TrackSkeleton = () => (
  <div className="flex items-center gap-4 p-3 rounded-2xl bg-white/5 animate-pulse">
    <div className="w-12 h-12 rounded-xl bg-white/10 flex-shrink-0" />
    <div className="flex-1 space-y-2">
      <div className="h-4 bg-white/10 rounded w-1/2" />
      <div className="h-3 bg-white/10 rounded w-1/3" />
    </div>
  </div>
);

const Visualizer = ({ playing }: { playing: boolean }) => {
  const [data, setData] = useState<number[]>(Array(32).fill(0));
  const requestRef = useRef<number>(0);

  useEffect(() => {
    const update = () => {
      if (playing) {
        setData(audioEngine.getFrequencyData().slice(0, 32));
      } else {
        setData(prev => prev.map(v => v * 0.85)); // Quick but smooth fade
      }
      requestRef.current = requestAnimationFrame(update);
    };
    requestRef.current = requestAnimationFrame(update);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [playing]);

  return (
    <div className="flex items-end justify-center h-28 w-full gap-1 sm:gap-2 mb-12">
      {data.map((v, i) => (
        <div
          key={i}
          className="w-1.5 sm:w-2 bg-gradient-to-t from-party-violet to-party-cyan rounded-full transition-[height] duration-75 relative group"
          style={{ height: `${Math.max(6, (v / 255) * 100)}%`, opacity: 0.3 + (v / 255) * 0.7 }}
        >
          {v > 180 && (
            <div className="absolute inset-x-0 -top-1 bottom-0 bg-party-cyan/30 blur-md rounded-full animate-pulse" />
          )}
        </div>
      ))}
    </div>
  );
};

// VibeSelector removed â€” Ambient Atmosphere feature removed

const Toast = ({ message, onClose }: { message: string, onClose: () => void }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 50, x: '-50%' }}
      animate={{ opacity: 1, y: 0, x: '-50%' }}
      exit={{ opacity: 0, scale: 0.95, y: 10, x: '-50%' }}
      className="fixed bottom-10 left-1/2 z-[1000] px-6 py-3 rounded-2xl shadow-2xl backdrop-blur-3xl bg-white/10 border border-white/20 flex items-center gap-3"
    >
      <div className="w-2 h-2 rounded-full bg-party-cyan animate-pulse" />
      <span className="text-xs font-black uppercase tracking-widest text-white">{message}</span>
    </motion.div>
  );
};

const ReactiveMiniEqualizer = ({ playing }: { playing: boolean }) => {
  const [data, setData] = useState<number[]>(Array(4).fill(2));
  const requestRef = useRef<number>(0);

  useEffect(() => {
    const update = () => {
      if (playing) {
        const freq = audioEngine.getFrequencyData();
        // Take samples from different frequency ranges for visual variety
        setData([freq[2], freq[8], freq[15], freq[25]].map(v => Math.max(2, (v / 255) * 12)));
      } else {
        setData(prev => prev.map(v => Math.max(2, v * 0.9)));
      }
      requestRef.current = requestAnimationFrame(update);
    };
    requestRef.current = requestAnimationFrame(update);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [playing]);

  return (
    <div className="flex gap-0.5 items-end h-3">
      {data.map((h, i) => (
        <div 
          key={i} 
          className="w-0.5 bg-party-violet rounded-full transition-[height] duration-75" 
          style={{ height: `${h}px` }} 
        />
      ))}
    </div>
  );
};

const ReactiveRings = ({ playing }: { playing: boolean }) => {
  const [scale, setScale] = useState(1);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    const update = () => {
      if (playing) {
        const freq = audioEngine.getFrequencyData();
        const bass = (freq[0] + freq[1] + freq[2] + freq[3]) / 4;
        setScale(1 + (bass / 255) * 0.25);
      } else {
        setScale(1);
      }
      requestRef.current = requestAnimationFrame(update);
    };
    requestRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(requestRef.current);
  }, [playing]);

  return (
    <div className="absolute inset-0 -z-10 pointer-events-none">
      <div 
        className="absolute -inset-8 border border-party-violet/20 rounded-[40px] transition-transform duration-75"
        style={{ transform: `scale(${scale})` }}
      />
      <div 
        className="absolute -inset-16 border border-party-cyan/10 rounded-[50px] transition-transform duration-75"
        style={{ transform: `scale(${1 + (scale - 1) * 1.8})` }}
      />
    </div>
  );
};

const ReactiveBackground = ({ playing }: { playing: boolean }) => {
  const [scale, setScale] = useState(1);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    const update = () => {
      if (playing) {
        const freq = audioEngine.getFrequencyData();
        // Average of lower frequencies for bass response
        const bass = (freq[0] + freq[1] + freq[2] + freq[3]) / 4;
        setScale(1 + (bass / 255) * 0.15);
      } else {
        setScale(1);
      }
      requestRef.current = requestAnimationFrame(update);
    };
    requestRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(requestRef.current);
  }, [playing]);

  return (
    <div 
      className="absolute -inset-16 bg-gradient-to-r from-party-violet to-party-cyan rounded-full blur-3xl opacity-20 transition-transform duration-75 pointer-events-none"
      style={{ transform: `scale(${scale})` }}
    />
  );
};

// --- UI COMPONENTS ---

const YouTubePlayer = ({ 
  videoId, 
  playing, 
  position, 
  onReady, 
  onEnd 
}: { 
  videoId: string, 
  playing: boolean, 
  position: number, 
  onReady: (player: any) => void,
  onEnd: () => void
}) => {
  const playerRef = useRef<any>(null);
  const playerOptions = useMemo(() => ({
    playerVars: {
      controls: 0,
      disablekb: 1,
      modestbranding: 1,
      rel: 0,
      playsinline: 1
    },
  }), []);

  useEffect(() => {
    if (playerRef.current) {
      if (playing) {
        playerRef.current.playVideo();
      } else {
        playerRef.current.pauseVideo();
      }
    }
  }, [playing]);

  useEffect(() => {
    if (playerRef.current) {
      const currentTime = playerRef.current.getCurrentTime();
      if (Math.abs(currentTime - position) > 2) {
        playerRef.current.seekTo(position, true);
      }
    }
  }, [position]);

  return (
    <div className="fixed -left-[1000px] -top-[1000px] w-[1px] h-[1px] opacity-0 pointer-events-none overflow-hidden">
      <YouTube
        videoId={videoId}
        opts={playerOptions}
        onReady={(e) => {
          playerRef.current = e.target;
          onReady(e.target);
        }}
        onEnd={onEnd}
        onError={(e) => console.error("YouTube Player Error:", e.data)}
      />
    </div>
  );
};

const formatTime = (seconds: number) => {
  const safeSeconds = Math.max(0, seconds || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = Math.floor(safeSeconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
};

const getProgressPercent = (currentTime: number, duration: number) => {
  if (!duration || duration <= 0) return 0;
  return Math.min(100, Math.max(0, (currentTime / duration) * 100));
};

const PlaybackProgress = ({ 
  currentTime, 
  duration, 
  rightLabel 
}: { 
  currentTime: number; 
  duration: number; 
  rightLabel?: string; 
}) => {
  const progress = getProgressPercent(currentTime, duration);
  return (
    <div className="w-full space-y-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-white/40 font-mono">
        <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
        <span>{rightLabel || `${Math.round(progress)}% complete`}</span>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden border border-white/5">
        <div className="h-full rounded-full bg-gradient-to-r from-party-violet via-party-cyan to-white/90 transition-[width] duration-300 ease-linear" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
};

const getPlaybackSeconds = (playback: PlaybackState, isPaused: boolean) => {
  if (!playback.playing || isPaused) {
    return playback.position / 1000;
  }

  const elapsed = Math.max(0, syncEngine.getCorrectedTime() - playback.timestamp);
  return (playback.position + elapsed) / 1000;
};

const NamePrompt = ({ onComplete }: { onComplete: (name: string) => void }) => {
  const [inputValue, setInputValue] = useState("");
  return (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      className="fixed inset-0 z-[100] glass flex items-center justify-center p-6"
    >
      <div className="glass-card max-w-sm w-full text-center">
        <h2 className="text-3xl font-display font-bold mb-4">Who's Partying?</h2>
        <input 
          autoFocus
          type="text" 
          placeholder="Enter your name" 
          className="w-full px-6 py-4 bg-white/5 border border-white/20 rounded-2xl mb-6 text-center text-xl"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && inputValue.trim()) {
              onComplete(inputValue.trim());
            }
          }}
        />
        <button 
          disabled={!inputValue.trim()}
          onClick={() => inputValue.trim() && onComplete(inputValue.trim())}
          className="btn-primary w-full"
        >
          Join the Waves
        </button>
        <p className="text-white/40 text-sm italic mt-4">Setting your stage name...</p>
      </div>
    </motion.div>
  );
};

const ReactionOverlay = ({ reactions }: { reactions: { id: string; type: string }[] }) => (
  <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
    <AnimatePresence>
      {reactions.map((r) => (
        <motion.div
           key={r.id}
           initial={{ y: "100%", x: `${Math.random() * 80 + 10}%`, scale: 0, opacity: 0 }}
           animate={{ y: "-20%", scale: 1, opacity: 1 }}
           exit={{ opacity: 0 }}
           transition={{ duration: 2, ease: "circOut" }}
           className="absolute text-5xl"
         >
           {r.type === 'fire' ? 'ðŸ”¥' : r.type === 'heart' ? 'â¤ï¸' : 'ðŸŽµ'}
         </motion.div>
      ))}
    </AnimatePresence>
  </div>
);

const Landing = ({ 
  onHost, 
  onJoin
}: { 
  onHost: () => void, 
  onJoin: () => void
}) => (
  <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
    <motion.div 
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="mb-12"
    >
      <h1 className="text-5xl sm:text-7xl font-display font-bold tracking-tighter mb-4 bg-clip-text text-transparent bg-gradient-to-r from-party-violet to-party-cyan">
        SyncWave
      </h1>
      <p className="text-lg sm:text-xl text-white/60 font-medium px-4">One beat. Every device. All together.</p>
    </motion.div>

    <div className="grid md:grid-cols-2 gap-6 max-w-4xl w-full">
      <motion.button
        whileHover={{ scale: 1.02, y: -5 }}
        whileTap={{ scale: 0.98 }}
        onClick={onHost}
        className="glass-card hover:bg-white/10 group text-left border-party-violet/20"
      >
        <div className="w-14 h-14 rounded-2xl bg-party-violet/20 flex items-center justify-center mb-6 group-hover:bg-party-violet/30 transition-colors">
          <Plus className="text-party-violet" size={32} />
        </div>
        <h2 className="text-3xl font-display font-bold mb-2">Start a Party</h2>
        <p className="text-white/40">Host a session and broadcast your library to 150+ devices.</p>
      </motion.button>

      <motion.button
        whileHover={{ scale: 1.02, y: -5 }}
        whileTap={{ scale: 0.98 }}
        onClick={onJoin}
        className="glass-card hover:bg-white/10 group text-left border-party-cyan/20"
      >
        <div className="w-14 h-14 rounded-2xl bg-party-cyan/20 flex items-center justify-center mb-6 group-hover:bg-party-cyan/30 transition-colors">
          <Users className="text-party-cyan" size={32} />
        </div>
        <h2 className="text-3xl font-display font-bold mb-2">Join a Party</h2>
        <p className="text-white/40">Connect to a live session via QR code or invite code.</p>
      </motion.button>
    </div>
  </div>
);

const JoinView = ({ onBack, onJoin }: { onBack: () => void, onJoin: (code: string) => void }) => {
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [scanning, setScanning] = useState(false);
  const [isPasting, setIsPasting] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const handlePaste = (e: React.ClipboardEvent) => {
    const pastedData = e.clipboardData.getData("text").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (pastedData.length >= 6) {
      e.preventDefault();
      const newChars = pastedData.split("").slice(0, 6);
      const newCode = [...code];
      newChars.forEach((char, idx) => { newCode[idx] = char; });
      setCode(newCode);
      setIsPasting(true);
      setTimeout(() => {
        onJoin(pastedData.slice(0, 6));
        setIsPasting(false);
      }, 500);
    }
  };

  useEffect(() => {
    // Auto-focus first input
    refs.current[0]?.focus();
  }, []);

  useEffect(() => {
    let html5QrCode: any = null;
    let isMounted = true;

    if (scanning) {
      const startScanner = async () => {
        const container = document.getElementById("reader");
        if (!container || !isMounted) return;

        try {
          const { Html5Qrcode } = await import("html5-qrcode");
          if (!isMounted) return;
          
          html5QrCode = new Html5Qrcode("reader");
          await html5QrCode.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 250, height: 250 } },
            (decodedText: string) => {
              const tryCode = decodedText.includes("join=") ? decodedText.split("join=")[1].split("&")[0] : decodedText;
              onJoin(tryCode.toUpperCase());
              setScanning(false);
            },
            () => {}
          );
        } catch (err: any) {
          console.error("Scanner error:", err);
          if (isMounted) {
            setScanning(false);
            if (err?.toString().includes("NotAllowedError") || err?.toString().includes("Permission denied")) {
              alert("Camera access denied. Please allow camera permissions in your browser/AI Studio settings.");
            }
          }
        }
      };

      startScanner();

      return () => {
        isMounted = false;
        if (html5QrCode) {
          if (html5QrCode.isScanning) {
            html5QrCode.stop().catch(() => {});
          }
        }
      };
    }
  }, [scanning, onJoin]);

  const handleStartScanning = async () => {
    setScanning(true);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-party-black/50 overflow-hidden relative">
      {/* Decorative background elements */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden -z-10">
        <motion.div 
          animate={{ 
            scale: [1, 1.2, 1],
            rotate: [0, 90, 180, 270, 360],
            opacity: [0.1, 0.2, 0.1]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 bg-party-violet/20 blur-[120px] rounded-full"
        />
        <motion.div 
          animate={{ 
            scale: [1.2, 1, 1.2],
            rotate: [360, 270, 180, 90, 0],
            opacity: [0.1, 0.2, 0.1]
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
          className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-party-cyan/20 blur-[120px] rounded-full"
        />
      </div>

      <button onClick={onBack} className="absolute top-8 left-8 text-white/40 hover:text-white flex items-center gap-2 px-4 py-2 glass rounded-full z-10 transition-all hover:bg-white/10 group">
        <LogOut size={20} className="rotate-180 group-hover:-translate-x-1 transition-transform" /> <span className="hidden sm:inline">Back home</span>
      </button>

      <motion.div 
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="glass-card max-w-md w-full text-center relative overflow-hidden p-8 sm:p-12 shadow-2xl border-white/10"
      >
        {scanning ? (
          <div className="space-y-6">
            <div className="flex flex-col items-center gap-2 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-party-violet/20 flex items-center justify-center">
                <QrCodeIcon size={24} className="text-party-violet animate-pulse" />
              </div>
              <h3 className="text-xl font-bold">Scanning...</h3>
              <p className="text-xs text-white/40">Point your camera at a host's QR code</p>
            </div>
            <div id="reader" className="w-full aspect-square rounded-[32px] overflow-hidden bg-black/40 border-2 border-white/10 relative">
               <div className="absolute inset-0 border-2 border-party-violet/50 rounded-[32px] animate-pulse pointer-events-none" />
            </div>
            <button 
              onClick={() => setScanning(false)}
              className="w-full py-4 rounded-2xl bg-white/5 hover:bg-white/10 font-bold transition-all border border-white/10"
            >
              Cancel Scan
            </button>
          </div>
        ) : (
          <>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 20 }}
              className="mb-8 inline-flex p-6 bg-party-violet/10 rounded-[32px] relative"
            >
              <div className="absolute inset-0 bg-party-violet/20 blur-xl animate-pulse rounded-full" />
              <Headphones size={48} className="text-party-violet relative z-10" />
            </motion.div>
            
            <h2 className="text-4xl font-display font-bold mb-3 tracking-tight">Join the Beat</h2>
            <p className="text-white/40 mb-10 leading-relaxed px-2 text-sm sm:text-base">Enter the <span className="text-party-violet font-bold">6-character code</span> or scan a host's QR code to synchronize your waves.</p>

            <div className="flex gap-2 sm:gap-4 justify-center mb-10">
              {code.map((char, i) => (
                <motion.div
                  key={i}
                  initial={false}
                  animate={isPasting ? { scale: [1, 1.1, 1], y: [0, -5, 0] } : {}}
                  transition={{ delay: i * 0.05 }}
                  className="relative"
                >
                  <input
                    ref={el => { refs.current[i] = el; }}
                    type="text"
                    maxLength={1}
                    placeholder="â€¢"
                    value={char}
                    className={`w-10 sm:w-14 h-14 sm:h-20 bg-white/5 border ${char ? 'border-party-violet bg-party-violet/5' : 'border-white/10'} rounded-xl sm:rounded-2xl text-center text-2xl sm:text-4xl font-display font-bold focus:border-party-violet focus:ring-4 focus:ring-party-violet/20 outline-none transition-all placeholder:text-white/10`}
                    onPaste={handlePaste}
                    onChange={(e) => {
                      const val = (e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9]/g, "");
                      if (val.length <= 1) {
                        const newCode = [...code];
                        newCode[i] = val;
                        setCode(newCode);
                        if (val && i < 5) {
                          refs.current[i + 1]?.focus();
                        }
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" && !code[i] && i > 0) {
                        const newCode = [...code];
                        newCode[i-1] = "";
                        setCode(newCode);
                        refs.current[i-1]?.focus();
                      } else if (e.key === "Enter" && !code.some(c => !c)) {
                        onJoin(code.join(""));
                      }
                    }}
                  />
                  {char && (
                    <motion.div 
                      layoutId={`glow-${i}`}
                      className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-4 h-1 bg-party-violet rounded-full blur-sm"
                    />
                  )}
                </motion.div>
              ))}
            </div>

            <motion.button 
              whileHover={{ scale: code.some(c => !c) ? 1 : 1.02 }}
              whileTap={{ scale: code.some(c => !c) ? 1 : 0.98 }}
              disabled={code.some(c => !c)}
              onClick={() => onJoin(code.join(""))}
              className="btn-primary w-full py-5 text-lg font-black tracking-widest shadow-[0_20px_40px_rgba(124,58,237,0.3)] disabled:shadow-none disabled:opacity-30 disabled:grayscale transition-all"
            >
              SYNC NOW
            </motion.button>

            <div className="mt-12 flex items-center gap-4">
              <div className="flex-1 h-px bg-white/5"></div>
              <span className="text-[10px] uppercase tracking-[0.2em] text-white/20 font-bold whitespace-nowrap">Instant Connect</span>
              <div className="flex-1 h-px bg-white/5"></div>
            </div>

            <button 
              onClick={handleStartScanning}
              className="mt-8 w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-all border border-white/10 font-bold text-white/60 hover:text-white group"
            >
              <QrCodeIcon size={20} className="group-hover:text-party-cyan transition-colors" /> <span className="text-sm">Scan QR Code</span>
            </button>
          </>
        )}
      </motion.div>
    </div>
  );
};

const SortableTrackItem = ({ 
  track, 
  isCurrent,
  onPlayTrack, 
  onRemoveFromQueue,
}: { 
  track: Track, 
  isCurrent: boolean,
  onPlayTrack: (t: Track) => void,
  onRemoveFromQueue: (id: string) => void,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: track.id });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 1,
    position: 'relative' as const,
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style}
      className={`flex flex-col mb-2 group ${isDragging ? 'shadow-2xl shadow-party-violet/20' : ''}`}
    >
      <div className={`flex items-center gap-3 p-3 rounded-2xl transition-all border ${isCurrent ? 'bg-party-violet/10 border-party-violet/40' : isDragging ? 'bg-white/20 border-party-violet/40' : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'} cursor-default`}>
        <div 
          {...attributes} 
          {...listeners}
          className="flex items-center px-1 cursor-grab active:cursor-grabbing text-white/20 hover:text-party-violet transition-colors"
        >
          <GripVertical size={20} />
        </div>
        <div 
           onClick={() => onPlayTrack(track)}
           className="w-12 h-12 rounded-xl bg-white/10 flex-shrink-0 flex items-center justify-center overflow-hidden cursor-pointer active:scale-95 transition-transform"
        >
          {track.coverArt ? <img src={track.coverArt} className="w-full h-full object-cover" /> : <Music size={16} />}
        </div>
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onPlayTrack(track)}>
          {isCurrent && (
            <div className="mb-1 text-[9px] font-black uppercase tracking-[0.25em] text-party-violet">Now Playing</div>
          )}
          <h4 className="font-bold truncate text-sm">{track.name}</h4>
          <p className="text-xs text-white/40 truncate">{track.artist}</p>
        </div>
        
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button 
            onClick={() => onRemoveFromQueue(track.id)}
            className="p-1.5 hover:bg-red-500/20 text-red-400 rounded-lg ml-1"
          >
            <LogOut size={14} className="rotate-45" />
          </button>
        </div>
      </div>
    </div>
  );
};

const HostDashboard = ({ 
  party, 
  userName, 
  duration, 
  currentTime, 
  onTogglePlayback, 
  onSeek, 
  onLeaveParty, 
  onLibraryView,
  onPlaylistsView,
  onKickListener,
  onMuteListener,
  onBanListener,
  onRemoveFromQueue,
  onMoveInQueue,
  onReorderQueue,
  onClearQueue,
  onPlayTrack,
  onSkipForward,
  onSkipBackward,
  onShowToast
}: { 
  party: Party | null, 
  userName: string, 
  duration: number, 
  currentTime: number, 
  onTogglePlayback: () => void, 
  onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void, 
  onLeaveParty: () => void, 
  onLibraryView: () => void,
  onPlaylistsView: () => void,
  onKickListener: (id: string) => void,
  onMuteListener: (id: string, muted: boolean) => void,
  onBanListener: (id: string) => void,
  onRemoveFromQueue: (id: string) => void,
  onMoveInQueue: (id: string, direction: 'up' | 'down') => void,
  onReorderQueue: (newQueue: Track[]) => void,
  onClearQueue: () => void,
  onPlayTrack: (track: Track) => void,
  onSkipForward: () => void,
  onSkipBackward: () => void,
  onShowToast: (msg: string) => void
}) => (
  <div className="min-h-screen grid lg:grid-cols-12 gap-6 p-6">
    <button onClick={onLeaveParty} className="absolute top-8 left-8 text-white/40 hover:text-white flex items-center gap-2 px-4 py-2 glass rounded-full z-10 transition-all hover:pl-2">
      <LogOut size={20} className="rotate-180" /> Leave
    </button>
    {/* Left Column: Now Playing */}
    <div className="lg:col-span-4 space-y-6">
      <div className="glass-card h-full flex flex-col items-center justify-center text-center">
        <div className="mb-4">
           <span className="px-3 py-1 bg-party-violet/20 text-party-violet rounded-full text-xs font-bold font-mono">HOST: {userName}</span>
        </div>
        <div className="relative mb-8 group">
          <div className="absolute -inset-4 bg-gradient-to-r from-party-violet to-party-cyan rounded-full opacity-20 blur-2xl group-hover:opacity-40 transition-opacity"></div>
          <div className="w-64 h-64 rounded-3xl bg-white/5 overflow-hidden border border-white/10 relative z-10">
            <AnimatePresence mode="wait">
              <motion.div
                key={party?.currentTrack?.id || "empty"}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                transition={{ duration: 0.5, ease: "easeInOut" }}
                className="w-full h-full"
              >
                {party?.currentTrack?.coverArt ? (
                  <img src={party.currentTrack.coverArt} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-white/10 to-transparent">
                    <Music size={80} className="text-white/20" />
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          {/* Animated Speaker Rings */}
          <ReactiveRings playing={party?.playbackState.playing || false} />
        </div>

        <motion.div
          key={party?.currentTrack?.id || "empty-text"}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="w-full text-center cursor-pointer"
          onClick={onTogglePlayback}
        >
          <h2 className="text-3xl font-display font-bold mb-1 truncate w-full">{party?.currentTrack?.name || "Ready to Rock"}</h2>
          <p className="text-white/40 mb-8">{party?.currentTrack?.artist || "Upload music to begin"}</p>
        </motion.div>

        <div className="flex items-center gap-8 mb-8">
          <motion.button 
            whileTap={{ scale: 0.9 }} 
            onClick={onSkipBackward}
            className="text-white/60 hover:text-white"
          >
            <SkipBack size={32} />
          </motion.button>
          <motion.button 
            whileTap={{ scale: 0.9 }}
            onClick={onTogglePlayback}
            className="w-20 h-20 rounded-full bg-white text-party-black flex items-center justify-center shadow-[0_0_30px_rgba(255,255,255,0.3)]"
          >
            {party?.playbackState.playing ? <Pause size={36} fill="currentColor" /> : <Play size={36} fill="currentColor" className="ml-1" />}
          </motion.button>
          <motion.button 
            whileTap={{ scale: 0.9 }} 
            onClick={onSkipForward}
            className="text-white/60 hover:text-white"
          >
            <SkipForward size={32} />
          </motion.button>
        </div>

        <div className="w-full relative mb-2 flex items-center px-4">
          <input 
            type="range"
            min={0}
            max={duration || 1}
            value={currentTime}
            onChange={onSeek}
            className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-party-violet"
          />
          <div className="absolute top-0 left-4 right-4 h-1.5 bg-white/10 rounded-full pointer-events-none overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-party-violet to-party-cyan rounded-full transition-[width] duration-300 ease-linear"
              style={{ width: `${getProgressPercent(currentTime, duration)}%` }}
            />
          </div>
        </div>
        <div className="px-4 w-full text-[10px] uppercase tracking-[0.2em] text-white/40 font-mono">
          <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
        </div>
      </div>
    </div>

    {/* Middle Column: Queue & Library */}
    <div className="lg:col-span-5 flex flex-col gap-6">
      <div className="glass-card flex-1 flex flex-col p-0 overflow-hidden">
        <div className="p-6 border-bottom border-white/10 flex justify-between items-center">
          <h3 className="text-xl font-bold flex items-center gap-2">
            <Music size={20} className="text-party-violet" />
            Music Queue
          </h3>
          <button 
            onClick={onClearQueue}
            className="text-[10px] uppercase tracking-widest text-red-400 font-bold hover:text-red-300 transition-colors"
          >
            Clear Queue
          </button>
        </div>
        <div className="flex-1 p-2 min-h-[400px] flex flex-col">
          {party?.queue.length === 0 && !party?.currentTrack ? (
            <div className="flex-1 flex flex-col items-center justify-center opacity-20 py-12">
              <Music size={48} className="mb-4" />
              <p>Queue is empty</p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col">
              {party?.currentTrack && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-3 mb-4 rounded-2xl bg-party-violet/10 border border-party-violet/20 relative overflow-hidden group shadow-lg shadow-party-violet/5"
                >
                  <div className="flex items-center gap-3 relative z-10">
                    <div className="w-12 h-12 rounded-xl bg-white/10 flex-shrink-0 flex items-center justify-center overflow-hidden border border-white/5">
                      {party.currentTrack.coverArt ? <img src={party.currentTrack.coverArt} className="w-full h-full object-cover" /> : <Music size={16} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[10px] font-black text-party-violet uppercase tracking-[0.2em]">Now Playing</span>
                        <ReactiveMiniEqualizer playing={party.playbackState.playing} />
                      </div>
                      <h4 className="font-bold truncate text-sm">{party.currentTrack.name}</h4>
                      <p className="text-xs text-white/40 truncate">{party.currentTrack.artist}</p>
                    </div>
                    <div className="text-right flex flex-col items-end">
                          <span className="text-[10px] font-mono text-white/40">{formatTime(currentTime)} / {formatTime(duration)}</span>
                    </div>
                  </div>
                  <div className="absolute bottom-0 left-0 h-1.5 bg-white/5 w-full">
                         <div 
                           className="h-full bg-gradient-to-r from-party-violet to-party-cyan transition-[width] duration-300 ease-linear"
                           style={{ width: `${getProgressPercent(currentTime, duration)}%` }}
                         />
                  </div>
                </motion.div>
              )}

              <div className="flex-1">
                <DndContext 
                  sensors={useSensors(
                    useSensor(PointerSensor, {
                      activationConstraint: {
                        distance: 5,
                      },
                    }),
                    useSensor(KeyboardSensor, {
                      coordinateGetter: sortableKeyboardCoordinates,
                    })
                  )}
                  collisionDetection={closestCenter}
                  onDragEnd={(event: DragEndEvent) => {
                    const { active, over } = event;
                    if (over && active.id !== over.id) {
                      const oldIndex = party?.queue.findIndex(t => t.id === active.id);
                      const newIndex = party?.queue.findIndex(t => t.id === over.id);
                      if (oldIndex !== undefined && newIndex !== undefined && oldIndex !== -1 && newIndex !== -1) {
                         const newQueue = arrayMove(party!.queue, oldIndex, newIndex);
                         onReorderQueue(newQueue);
                      }
                    }
                  }}
                  modifiers={[restrictToVerticalAxis]}
                >
                  <SortableContext 
                    items={party?.queue.map(t => t.id) || []}
                    strategy={verticalListSortingStrategy}
                  >
                    <Virtuoso
                      style={{ height: '420px' }}
                      data={party?.queue || []}
                      className="scrollbar-hide"
                      itemContent={(index, track) => (
                        <SortableTrackItem 
                          key={track.id}
                          track={track}
                          isCurrent={party?.currentTrack?.id === track.id}
                          onPlayTrack={onPlayTrack}
                          onRemoveFromQueue={onRemoveFromQueue}
                        />
                      )}
                    />
                  </SortableContext>
                </DndContext>
              </div>
            </div>
          )}
        </div>
        <div className="p-4 bg-white/5 grid grid-cols-2 gap-2">
          <button 
            onClick={onLibraryView}
            className="py-3 rounded-xl bg-white/10 hover:bg-white/20 font-bold transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <Plus size={18} /> Library
          </button>
          <button 
            onClick={onPlaylistsView}
            className="py-3 rounded-xl bg-party-violet/20 hover:bg-party-violet/30 text-party-violet font-bold transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <Headphones size={18} /> Playlists
          </button>
        </div>
      </div>
    </div>

    {/* Right Column: Session Info */}
    <div className="lg:col-span-3 space-y-6">
      <div className="glass-card text-center">
        <a 
          href={`${window.location.origin}?join=${party?.code}`}
          target="_blank"
          rel="noreferrer"
          className="bg-white p-4 rounded-3xl inline-block mb-6 shadow-2xl hover:scale-105 transition-transform"
        >
          <QRCodeSVG value={`${window.location.origin}?join=${party?.code}`} size={160} level="H" />
        </a>
        <h3 className="text-sm uppercase tracking-[0.2em] text-white/40 font-bold mb-2">Session Code</h3>
        <div className="text-5xl font-display font-black tracking-widest mb-6 bg-clip-text text-transparent bg-gradient-to-r from-party-violet to-party-cyan">
          {party?.code}
        </div>
        <button 
           onClick={() => {
             const inviteLink = `${window.location.origin}?join=${party?.code}`;
             if (navigator.clipboard && navigator.clipboard.writeText) {
               navigator.clipboard.writeText(inviteLink)
                 .then(() => onShowToast("Invite link copied to clipboard!"))
                 .catch(() => onShowToast("Failed to copy link."));
             } else {
               // Fallback
               const textArea = document.createElement("textarea");
               textArea.value = inviteLink;
               document.body.appendChild(textArea);
               textArea.select();
               try {
                 document.execCommand('copy');
                 onShowToast("Invite link copied to clipboard!");
               } catch (err) {
                 onShowToast("Failed to copy link: " + inviteLink);
               }
               document.body.removeChild(textArea);
             }
           }}
           className="flex items-center gap-2 mx-auto px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 text-xs font-bold transition-all"
        >
          <Share2 size={14} /> Copy Invite Link
        </button>
      </div>

      <div className="glass-card">
         <div className="flex justify-between items-center mb-4">
           <h3 className="text-lg font-bold flex items-center gap-2">
             <Users size={20} className="text-party-cyan" />
             Listeners
           </h3>
           <div className="flex items-center gap-2">
             <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
             <span className="font-mono">{party?.listeners.length}</span>
           </div>
         </div>
         <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
            {party?.listeners.map((l, i) => (
              <div key={`${l.id}-${i}`} className="flex flex-col gap-2 p-3 rounded-xl bg-white/5 border border-white/5 group relative overflow-hidden transition-all hover:bg-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-party-cyan/20 flex items-center justify-center relative">
                    <Headphones size={14} className="text-party-cyan" />
                    {l.isMuted && (
                      <div className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5">
                        <MicOff size={8} className="text-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs truncate font-bold flex items-center gap-2">
                      {l.name}
                      {l.isMuted && <span className="text-[8px] uppercase px-1 py-0.5 bg-red-500/20 text-red-500 rounded">Muted</span>}
                    </div>
                    <div className="text-[10px] text-white/30 truncate">{l.id === syncEngine.socket.id ? "(You)" : l.device_info.split("(")[0]}</div>
                  </div>
                </div>
                
                {l.id !== syncEngine.socket.id && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all pt-1 border-t border-white/5">
                    <button 
                      onClick={() => onMuteListener(l.id, !l.isMuted)}
                      className={`flex-1 text-[10px] py-1 rounded-md font-bold transition-colors flex items-center justify-center gap-1 ${l.isMuted ? 'bg-party-cyan/20 text-party-cyan' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
                      title={l.isMuted ? "Unmute" : "Mute"}
                    >
                      {l.isMuted ? <Mic size={10} /> : <MicOff size={10} />}
                      {l.isMuted ? "Unmute" : "Mute"}
                    </button>
                    <button 
                      onClick={() => onKickListener(l.id)}
                      className="flex-1 text-[10px] py-1 rounded-md bg-white/5 text-white/40 hover:bg-red-500/20 hover:text-red-400 font-bold transition-colors flex items-center justify-center gap-1"
                      title="Kick"
                    >
                      <UserMinus size={10} />
                      Kick
                    </button>
                    <button 
                      onClick={() => onBanListener(l.id)}
                      className="flex-1 text-[10px] py-1 rounded-md bg-white/5 text-white/40 hover:bg-red-600/20 hover:text-red-500 font-bold transition-colors flex items-center justify-center gap-1"
                      title="Ban"
                    >
                      <Ban size={10} />
                      Ban
                    </button>
                  </div>
                )}
              </div>
            ))}
         </div>
      </div>

      <button 
        onClick={onLeaveParty}
        className="w-full py-4 rounded-2xl bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold transition-colors flex items-center justify-center gap-2"
      >
        <LogOut size={20} /> End Party
      </button>
    </div>
  </div>
);

const ListenerView = ({ 
  party, 
  isLocalPaused, 
  currentTime, 
  duration, 
  onToggleLocalPause, 
  onLeave, 
  syncOffset,
  onSuggestTrack
}: { 
  party: Party | null, 
  isLocalPaused: boolean, 
  currentTime: number, 
  duration: number, 
  onToggleLocalPause: () => void, 
  onLeave: () => void, 
  syncOffset: number,
  onSuggestTrack: (q: string) => Promise<{ success: boolean; error: string | null }>
}) => {
  const me = party?.listeners.find(l => l.id === syncEngine.socket.id);
  const isMuted = me?.isMuted;
  const syncQuality = Math.abs(syncOffset) < 50 ? 'great' : Math.abs(syncOffset) < 150 ? 'good' : 'poor';
  const syncColor = syncQuality === 'great' ? 'text-green-400' : syncQuality === 'good' ? 'text-yellow-400' : 'text-red-400';
  const syncDot  = syncQuality === 'great' ? 'bg-green-400' : syncQuality === 'good' ? 'bg-yellow-400' : 'bg-red-400';

  const [showSuggest, setShowSuggest] = useState(false);
  const [suggestQuery, setSuggestQuery] = useState('');
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestMsg, setSuggestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleSuggest = async () => {
    if (!suggestQuery.trim() || suggestLoading) return;
    setSuggestLoading(true); setSuggestMsg(null);
    const r = await onSuggestTrack(suggestQuery.trim());
    setSuggestLoading(false);
    if (r.success) {
      setSuggestMsg({ ok: true, text: `Added "${suggestQuery}" to queue!` });
      setSuggestQuery('');
      setTimeout(() => { setShowSuggest(false); setSuggestMsg(null); }, 2000);
    } else {
      setSuggestMsg({ ok: false, text: r.error || 'Nothing found. Try different keywords.' });
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-transparent">

      {/* â”€â”€â”€ Top bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 py-3 bg-gradient-to-b from-black/70 to-transparent">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${syncDot} animate-pulse`} />
          <span className={`text-[11px] font-mono font-bold ${syncColor} uppercase tracking-wider`}>
            {syncQuality === 'great' ? 'Synced' : syncQuality === 'good' ? 'Syncing' : 'Lag'} Â· {Math.abs(syncOffset).toFixed(0)}ms
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-white/40 px-2.5 py-1 glass rounded-full flex items-center gap-1.5">
            <Users size={10} className="text-party-cyan" /> {party?.listeners.length ?? 0}
          </span>
          <button onClick={onLeave} className="text-[11px] font-bold px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 flex items-center gap-1.5 transition-all">
            <LogOut size={10} /> Leave
          </button>
        </div>
      </div>

      {/* â”€â”€â”€ Body â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="flex flex-col items-center justify-center min-h-screen px-6 pt-16 pb-8 gap-5">

        {/* Album Art */}
        <div className="relative w-64 h-64 sm:w-72 sm:h-72 flex-shrink-0">
          <ReactiveBackground playing={party?.playbackState.playing && !isLocalPaused || false} />
          <div className="relative z-10 w-full h-full rounded-[36px] overflow-hidden border border-white/10 shadow-2xl">
            <AnimatePresence mode="wait">
              <motion.div key={party?.currentTrack?.id || 'empty'} initial={{ opacity: 0, scale: 1.05 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }} className="w-full h-full">
                {party?.currentTrack?.coverArt
                  ? <img src={party.currentTrack.coverArt} className="w-full h-full object-cover" alt="" />
                  : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-party-violet/10 to-transparent"><Music size={80} className="text-white/10" /></div>
                }
              </motion.div>
            </AnimatePresence>
          </div>
          {party?.playbackState.playing && !isLocalPaused && [0, 1, 2].map(i => (
            <motion.div key={i} initial={{ scale: 1, opacity: 0.2 }} animate={{ scale: 1.9, opacity: 0 }}
              transition={{ repeat: Infinity, duration: 2.5, delay: i * 0.75 }}
              className="absolute inset-0 rounded-[36px] border border-party-violet/20 z-0"
            />
          ))}
        </div>

        {/* Track info */}
        <motion.div key={party?.currentTrack?.id || 'idle'} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-center w-full max-w-xs">
          <h2 className="text-xl font-display font-bold truncate mb-1">{party?.currentTrack?.name || 'Waiting for hostâ€¦'}</h2>
          <p className="text-sm text-white/40 truncate">{party?.currentTrack?.artist || 'Connect & vibe'}</p>
        </motion.div>

        {/* Progress */}
        {party?.currentTrack && (
          <div className="w-full max-w-xs">
            <PlaybackProgress currentTime={currentTime} duration={duration} />
          </div>
        )}

        {/* Mini Visualizer */}
        <div className="w-full max-w-xs">
          <Visualizer playing={!!(party?.playbackState.playing && !isLocalPaused)} />
        </div>

        {/* Muted banner */}
        <AnimatePresence>
          {isMuted && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold">
              <MicOff size={12} /> Muted by host
            </motion.div>
          )}
        </AnimatePresence>

        {/* Controls: emojis + pause */}
        <div className="flex items-center gap-3">
          {(['ðŸ”¥','â¤ï¸','ðŸŽµ'] as const).map((emoji, i) => {
            const type = ['fire','heart','music'][i];
            return (
              <motion.button key={emoji}
                whileTap={{ scale: isMuted ? 1 : 0.65 }}
                whileHover={{ scale: isMuted ? 1 : 1.12, y: isMuted ? 0 : -2 }}
                onClick={() => !isMuted && syncEngine.socket.emit('client:reaction', { code: party?.code, type })}
                disabled={!!isMuted}
                className={`w-13 h-13 w-[52px] h-[52px] rounded-2xl glass text-2xl flex items-center justify-center transition-all ${isMuted ? 'opacity-20 cursor-not-allowed' : 'hover:bg-white/10'}`}
              >{emoji}</motion.button>
            );
          })}

          <motion.button whileTap={{ scale: 0.9 }} onClick={onToggleLocalPause}
            className={`w-[52px] h-[52px] rounded-2xl flex items-center justify-center transition-all ${
              isLocalPaused ? 'bg-party-violet shadow-lg shadow-party-violet/40 text-white' : 'glass hover:bg-white/10'
            }`}
          >
            {isLocalPaused ? <Play size={20} /> : <Pause size={20} />}
          </motion.button>
        </div>

        {isLocalPaused && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-party-violet/80 animate-pulse -mt-2">
            Paused locally Â· tap â–¶ to resync
          </motion.p>
        )}

        {/* Suggest a Track */}
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
          onClick={() => { setShowSuggest(true); setSuggestMsg(null); }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 text-sm font-bold transition-all"
        >
          <Plus size={14} className="text-party-cyan" /> Suggest a Track
        </motion.button>

        <div className="text-[10px] font-mono text-white/20 tracking-widest">SESSION Â· {party?.code}</div>
      </div>

      {/* â”€â”€â”€ Suggest Track Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <AnimatePresence>
        {showSuggest && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) setShowSuggest(false); }}
          >
            <motion.div initial={{ y: 50, scale: 0.96 }} animate={{ y: 0, scale: 1 }} exit={{ y: 50, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 280, damping: 26 }}
              className="w-full max-w-md glass-card p-6"
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-display font-bold flex items-center gap-2">
                  <Music size={16} className="text-party-cyan" /> Suggest a Track
                </h3>
                <button onClick={() => setShowSuggest(false)} className="text-white/30 hover:text-white p-1"><LogOut size={14} className="rotate-180" /></button>
              </div>
              <p className="text-xs text-white/35 mb-4">Search by song name or artist â€” it'll be added to the host's queue.</p>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                  <input autoFocus type="text" placeholder="e.g. Blinding Lightsâ€¦"
                    className="w-full pl-8 pr-3 py-2.5 text-sm bg-white/5 border border-white/10 rounded-xl focus:border-party-violet outline-none transition-colors"
                    value={suggestQuery}
                    onChange={e => { setSuggestQuery(e.target.value); setSuggestMsg(null); }}
                    onKeyDown={e => e.key === 'Enter' && handleSuggest()}
                  />
                </div>
                <button onClick={handleSuggest} disabled={suggestLoading || !suggestQuery.trim()}
                  className="px-4 py-2.5 rounded-xl bg-party-violet hover:bg-party-violet/80 text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-all"
                >
                  {suggestLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><Plus size={14} /> Add</>}
                </button>
              </div>

              <AnimatePresence>
                {suggestMsg && (
                  <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className={`mt-3 text-xs font-medium px-1 ${suggestMsg.ok ? 'text-green-400' : 'text-red-400'}`}
                  >
                    {suggestMsg.ok ? 'âœ“' : 'âš '} {suggestMsg.text}
                  </motion.p>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const LibraryView = ({ 
  myLibrary, 
  onSearch, 
  onUpload, 
  onAddToQueue,
  onPlayTrackNow,
  onRemoveTrack, 
  onBack 
}: { 
  myLibrary: Track[], 
  onSearch: (q: string) => Promise<{ success: boolean, error: string | null }>, 
  onUpload: (e: any, onStatus: any) => void, 
  onAddToQueue: (t: Track) => void,
  onPlayTrackNow: (t: Track) => void,
  onRemoveTrack: (t: Track) => void, 
  onBack: () => void 
}) => {
  // Helper: Detect if input is a platform URL (Spotify, SoundCloud, etc)
  const detectPlatformUrl = (input: string): boolean => {
    return /(?:spotify\.com|open\.spotify|soundcloud\.com|apple\.com\/music|deezer\.com)/.test(input);
  };
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<{name: string, artist: string}[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{ loading: boolean, error: string | null }>({ loading: false, error: null });

  // Filter states
  const [filterArtist, setFilterArtist] = useState("");
  const [filterAlbum, setFilterAlbum] = useState("");
  const [filterGenre, setFilterGenre] = useState("");

  const filteredLibrary = useMemo(() => {
    return myLibrary.filter(track => {
      const matchArtist = !filterArtist || track.artist?.toLowerCase().includes(filterArtist.toLowerCase());
      const matchAlbum = !filterAlbum || (track.album && track.album.toLowerCase().includes(filterAlbum.toLowerCase()));
      const matchGenre = !filterGenre || (track.genre && track.genre.toLowerCase().includes(filterGenre.toLowerCase()));
      return matchArtist && matchAlbum && matchGenre;
    });
  }, [myLibrary, filterArtist, filterAlbum, filterGenre]);

  useEffect(() => {
    const fetchYouTubeSuggestions = async () => {
      if (searchQuery.length < 3) {
        setSuggestions([]);
        return;
      }
      
      setIsSuggesting(true);
      try {
        // Check if it's a platform URL
        const isPlatformUrl = detectPlatformUrl(searchQuery);
        const videoIdMatch = searchQuery.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        
        let endpoint = "/api/youtube/search";
        let query = searchQuery;

        if (isPlatformUrl) {
          endpoint = "/api/music/resolve-url";
          query = searchQuery;
        } else if (videoIdMatch) {
          query = videoIdMatch[1];
        }

        const res = await fetch(`${endpoint}?${isPlatformUrl ? 'url' : 'q'}=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setSuggestions(data);
      } catch (e) {
        console.warn("Search failed", e);
      } finally {
        setIsSuggesting(false);
      }
    };

    const timer = setTimeout(fetchYouTubeSuggestions, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSearchClick = async (e?: React.FormEvent, qOverride?: string) => {
    if (e) e.preventDefault();
    const q = qOverride || searchQuery;
    if (!q.trim()) return;
    setSuggestions([]);
    setSearchError(null);
    setIsSearching(true);
    const result = await onSearch(q);
    setIsSearching(false);
    if (result.success) {
      setSearchQuery("");
    } else {
      setSearchError(result.error);
    }
  };

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-6xl mx-auto flex flex-col h-full">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
           <div>
             <button onClick={onBack} className="text-white/40 hover:text-white flex items-center gap-2 mb-4">
               <LogOut size={20} className="rotate-180" /> Back
             </button>
             <h2 className="text-4xl font-display font-bold">Add Music</h2>
           </div>
           
           <div className="flex flex-col w-full gap-2">
             <div className="flex flex-col sm:flex-row gap-4 w-full">
                <form onSubmit={handleSearchClick} className="flex-1 min-w-[250px] relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40">
                    {(isSearching || isSuggesting) ? <Loader2 size={20} className="animate-spin text-party-violet" /> : <Search size={20} />}
                  </div>
                  <input 
                    type="text" 
                    placeholder="Search music (e.g. 'Chill lo-fi', YouTube URL, or Spotify link)" 
                    className="w-full pl-12 pr-12 py-3 bg-white/5 border border-white/10 rounded-full focus:border-party-violet outline-none transition-all"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <AnimatePresence>
                    {searchQuery && (
                      <motion.button 
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        type="submit"
                        disabled={isSearching}
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-party-violet flex items-center justify-center text-white disabled:opacity-50 shadow-lg shadow-party-violet/20"
                      >
                        <Plus size={18} />
                      </motion.button>
                    )}
                  </AnimatePresence>
                  {(isSearching || isSuggesting) && (
                    <div className="absolute right-12 top-1/2 -translate-y-1/2 flex items-center gap-2">
                       <span className="text-[10px] font-black text-party-violet uppercase tracking-tighter animate-pulse">{isSearching ? "Searching..." : "Suggestions..."}</span>
                    </div>
                  )}
                  
                  {suggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-2 glass-card p-2 z-[100] border-party-violet/20 shadow-2xl">
                      {suggestions.map((s: any, i) => (
                        <button 
                          key={i}
                          onClick={() => {
                            const track: Track = {
                              id: s.id,
                              name: s.title,
                              artist: s.artist,
                              url: s.id,
                              duration: s.duration,
                              type: 'youtube',
                              coverArt: s.thumbnail
                            };
                            onAddToQueue(track);
                            setSearchQuery("");
                            setSuggestions([]);
                          }}
                          className="w-full text-left p-3 hover:bg-white/5 rounded-xl flex items-center gap-3 transition-colors group"
                        >
                          <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
                            {s.thumbnail ? (
                              <img src={s.thumbnail} className="w-full h-full object-cover" alt="" referrerPolicy="no-referrer" />
                            ) : (
                              <Music className="w-full h-full p-2 text-white/20" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold truncate group-hover:text-party-violet transition-colors">{s.title}</div>
                            <div className="text-[10px] text-white/40 truncate">{s.artist}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </form>

                <label className={`btn-primary cursor-pointer flex items-center gap-2 whitespace-nowrap ${uploadStatus.loading ? 'opacity-50 pointer-events-none' : ''}`}>
                  {uploadStatus.loading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Upload size={20} />
                  )}
                  {uploadStatus.loading ? 'Uploading...' : 'Upload MP3'}
                  <input 
                    type="file" 
                    className="hidden" 
                    accept="audio/*" 
                    onChange={(e) => onUpload(e, setUploadStatus)} 
                    disabled={uploadStatus.loading}
                  />
                </label>
             </div>
             
             <AnimatePresence>
               {(searchError || uploadStatus.error) && (
                 <motion.div 
                   initial={{ opacity: 0, scale: 0.95, y: -10 }}
                   animate={{ opacity: 1, scale: 1, y: 0 }}
                   exit={{ opacity: 0, scale: 0.95, y: -10 }}
                   className="mt-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2 text-red-400 text-sm font-medium"
                 >
                   <span className="flex-1">{searchError || uploadStatus.error}</span>
                   <button onClick={() => { setSearchError(null); setUploadStatus(p => ({...p, error: null})); }} className="text-white/40 hover:text-white"><LogOut size={16} className="rotate-45" /></button>
                 </motion.div>
               )}
             </AnimatePresence>
           </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8 p-4 glass rounded-2xl border border-white/10">
          <div className="flex-1">
             <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-2 block">Filter Artist</label>
             <input 
               type="text" 
               placeholder="Artist name..." 
               className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:border-party-violet outline-none transition-colors"
               value={filterArtist}
               onChange={e => setFilterArtist(e.target.value)}
             />
          </div>
          <div className="flex-1">
             <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-2 block">Filter Album</label>
             <input 
               type="text" 
               placeholder="Album name..." 
               className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:border-party-violet outline-none transition-colors"
               value={filterAlbum}
               onChange={e => setFilterAlbum(e.target.value)}
             />
          </div>
          <div className="flex-1">
             <label className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-2 block">Filter Genre</label>
             <input 
               type="text" 
               placeholder="Genre..." 
               className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:border-party-violet outline-none transition-colors"
               value={filterGenre}
               onChange={e => setFilterGenre(e.target.value)}
             />
          </div>
          <button 
            onClick={() => { setFilterArtist(""); setFilterAlbum(""); setFilterGenre(""); }}
            className="col-span-1 sm:col-span-2 lg:col-span-1 px-4 py-2 text-sm font-bold text-white/40 hover:text-white hover:bg-white/5 transition-colors rounded-lg self-end lg:self-center"
          >
            Reset
          </button>
        </div>

        <div className="flex-1 min-h-[400px] flex flex-col">
          {isSearching ? (
             <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                {Array.from({length: 12}).map((_, i) => <TrackSkeleton key={i} />)}
             </div>
          ) : filteredLibrary.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center opacity-20 py-20">
               <Music size={80} className="mx-auto mb-4" />
               <p className="text-xl">No tracks match your filters.</p>
            </div>
          ) : (
            <VirtuosoGrid
              style={{ height: '600px' }}
              data={filteredLibrary}
              listClassName="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 pb-24 pr-2"
              itemContent={(index, track) => (
                <motion.div
                  key={`${track.id}-${index}`}
                  variants={staggerItem}
                  initial="initial"
                  animate="animate"
                  className="glass-card group flex flex-col border-white/5 hover:border-party-violet/20 h-full"
                >
                  <div className="aspect-square rounded-xl bg-white/10 mb-4 overflow-hidden relative flex-shrink-0">
                    {track.coverArt ? (
                      <img src={track.coverArt} className="w-full h-full object-cover" />
                    ) : (
                      <Music className="w-full h-full p-12 text-white/5" />
                    )}
                  </div>
                  <h4 className="font-bold truncate text-sm flex-grow">{track.name}</h4>
                  <p className="text-xs text-white/40 truncate mb-4">{track.artist}</p>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => onPlayTrackNow(track)}
                      className="py-2 px-2 bg-party-violet/20 hover:bg-party-violet/40 text-xs font-bold text-party-violet rounded-lg transition-colors flex items-center justify-center gap-1"
                      title="Play now"
                    >
                      <Play size={14} />
                    </button>
                    <button
                      onClick={() => onAddToQueue(track)}
                      className="py-2 px-2 bg-white/10 hover:bg-white/20 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1"
                      title="Add to queue"
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      onClick={() => onRemoveTrack(track)}
                      className="py-2 px-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded-lg transition-colors flex items-center justify-center gap-1"
                      title="Remove from library"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </motion.div>
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
};



export default function App() {
  const [view, setView] = useState<View>("landing");
  const [party, setParty] = useState<Party | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [myLibrary, setMyLibrary] = useState<Track[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [reactions, setReactions] = useState<{ id: string; type: string }[]>([]);
  const [userName, setUserName] = useState(localStorage.getItem("syncwave_user") || "");
  const [userId] = useState(() => {
    let id = localStorage.getItem("syncwave_userId");
    if (!id) {
      id = nanoid();
      localStorage.setItem("syncwave_userId", id);
    }
    return id;
  });
  const [showNamePrompt, setShowNamePrompt] = useState(!localStorage.getItem("syncwave_user"));
  const [isLocalPaused, setIsLocalPaused] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const ytPlayerRef = useRef<any>(null);

  // Helper: Extract YouTube video ID from URL
  const extractYouTubeId = (input: string): string | null => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
      /^([a-zA-Z0-9_-]{11})$/ // Direct video ID
    ];
    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match) return match[1];
    }
    return null;
  };

  // Helper: Detect if input is a platform URL (Spotify, SoundCloud, etc)
  const detectPlatformUrl = (input: string): boolean => {
    return /(?:spotify\.com|open\.spotify|soundcloud\.com|apple\.com\/music|deezer\.com)/.test(input);
  };

  // Ambient vibe removed

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [view]);

  const onShowProfile = () => {
    alert("Profile features are disabled in session-only mode.");
  };

  const onLogout = async () => {
    if (confirm("Reset local identity? This will clear your stage name.")) {
      localStorage.removeItem("syncwave_user");
      setUserName("");
      setShowNamePrompt(true);
      setView("landing");
      setParty(null);
    }
  };

  // Pending join code — stored when user needs to enter name first
  const [pendingJoinCode, setPendingJoinCode] = React.useState<string | null>(null);

  const joinSession = React.useCallback((code: string) => {
    const upperCode = code.toUpperCase().trim();
    if (!upperCode || upperCode.length < 6) {
      setToast("Invalid session code. Please enter a 6-character code.");
      return;
    }

    // If no name yet, show name prompt and store code to join after
    if (!userName) {
      setPendingJoinCode(upperCode);
      setShowNamePrompt(true);
      return;
    }

    setIsHost(false);
    syncEngine.socket.emit("party:join", { code: upperCode, listener_id: userId, listener_name: userName }, (res: { success: boolean, error?: string }) => {
      if (res.success) {
        setView("listener");
        const url = new URL(window.location.href);
        url.searchParams.set("join", upperCode);
        window.history.pushState({}, "", url);
      } else {
        setToast(res.error || `Session "${upperCode}" not found. Check the code and try again.`);
      }
    });
  }, [userName, userId]);

  useEffect(() => {
    syncEngine.socket.on("party:kicked", () => {
      setToast("You have been kicked from the party.");
      setParty(null);
      setView("landing");
    });
    syncEngine.socket.on("party:banned", () => {
      setToast("You have been banned from this party.");
      setParty(null);
      setView("landing");
    });
    return () => {
      syncEngine.socket.off("party:kicked");
      syncEngine.socket.off("party:banned");
    };
  }, []);

  // Ambient vibe effect removed

  const leaveSession = React.useCallback(() => {
    if (party) {
      syncEngine.socket.emit("party:leave", { code: party.code });
      setParty(null);
      setView("landing");
      const url = new URL(window.location.href);
      url.searchParams.delete("join");
      window.history.pushState({}, "", url);
    }
  }, [party]);

  const playTrackNow = React.useCallback((track: Track) => {
    if (!party || !isHost) return;
    syncEngine.socket.emit("sync:play", { code: party.code, track_id: track.id, position_ms: 0 });
  }, [party, isHost]);

  const playQueueTrack = React.useCallback((direction: "next" | "previous") => {
    if (!party || !isHost || party.queue.length === 0) return;

    const currentIndex = party.currentTrack ? party.queue.findIndex((track) => track.id === party.currentTrack?.id) : -1;
    const targetIndex = direction === "next"
      ? (currentIndex >= 0 ? currentIndex + 1 : 0)
      : (currentIndex > 0 ? currentIndex - 1 : 0);

    const targetTrack = party.queue[targetIndex];
    if (targetTrack) {
      syncEngine.socket.emit("sync:play", { code: party.code, track_id: targetTrack.id, position_ms: 0 });
    }
  }, [party, isHost]);

  // updateVibe removed with Ambient Atmosphere feature

  const clearQueue = React.useCallback(() => {
    if (!party || !isHost) return;
    if (confirm("Clear the entire queue?")) {
      syncEngine.socket.emit("queue:update", { code: party.code, queue: [] });
    }
  }, [party, isHost]);

  const skipForward = React.useCallback(() => {
    playQueueTrack("next");
  }, [playQueueTrack]);

  const skipBackward = React.useCallback(() => {
    if (!party || !isHost) return;

    const currentIndex = party.currentTrack ? party.queue.findIndex((track) => track.id === party.currentTrack?.id) : -1;

    if (currentTime > 3 && currentIndex <= 0) {
      syncEngine.socket.emit("sync:seek", { code: party.code, position_ms: 0 });
      if (party.currentTrack?.type === 'youtube' && ytPlayerRef.current) {
        ytPlayerRef.current.seekTo(0, true);
      } else {
        audioEngine.seek(0);
      }
      return;
    }

    const previousIndex = currentIndex > 0 ? currentIndex - 1 : 0;
    const targetTrack = party.queue[previousIndex];
    if (targetTrack) {
      syncEngine.socket.emit("sync:play", { code: party.code, track_id: targetTrack.id, position_ms: 0 });
    }
  }, [isHost, party, currentTime]);

  const kickListener = React.useCallback((listenerId: string) => {
    if (!party || !isHost) return;
    syncEngine.socket.emit("party:kick", { code: party.code, listener_id: listenerId });
  }, [party, isHost]);

  const muteListener = React.useCallback((listenerId: string, muted: boolean) => {
    if (!party || !isHost) return;
    syncEngine.socket.emit("party:mute", { code: party.code, listener_id: listenerId, muted });
  }, [party, isHost]);

  const banListener = React.useCallback((listenerId: string) => {
    if (!party || !isHost) return;
    if (confirm("Are you sure you want to ban this user? They will not be able to rejoin.")) {
      syncEngine.socket.emit("party:ban", { code: party.code, listener_id: listenerId });
    }
  }, [party, isHost]);

  const removeFromQueue = React.useCallback((trackId: string) => {
    if (!party || !isHost) return;
    const newQueue = party.queue.filter(t => t.id !== trackId);
    syncEngine.socket.emit("queue:update", { code: party.code, queue: newQueue });
  }, [party, isHost]);

  const moveInQueue = React.useCallback((trackId: string, direction: 'up' | 'down') => {
    if (!party || !isHost) return;
    const index = party.queue.findIndex(t => t.id === trackId);
    if (index === -1) return;
    
    const newQueue = [...party.queue];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    
    if (targetIndex >= 0 && targetIndex < newQueue.length) {
      [newQueue[index], newQueue[targetIndex]] = [newQueue[targetIndex], newQueue[index]];
      syncEngine.socket.emit("queue:update", { code: party.code, queue: newQueue });
    }
  }, [party, isHost]);

  const onReorderQueue = React.useCallback((newQueue: Track[]) => {
    if (!party || !isHost) return;
    syncEngine.socket.emit("queue:update", { code: party.code, queue: newQueue });
  }, [party, isHost]);

  // Load Library from Dexie
  useEffect(() => {
    const loadLibrary = async () => {
      const tracks = await musicDb.tracks.toArray();
      setMyLibrary(tracks);
    };
    loadLibrary();
  }, []);

  // Sync Library (no-op now, we use Dexie directly)
  const refreshLibrary = async () => {
    const tracks = await musicDb.tracks.toArray();
    setMyLibrary(tracks);
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setReactions(prev => prev.filter(r => Date.now() - Number(r.id.split('-')[0]) < 2000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // â”€â”€ Always-on reaction listener (works for both host AND listener) â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    const socket = syncEngine.socket;
    const handler = ({ type }: { type: string }) => {
      setReactions(prev => [...prev, { id: `${Date.now()}-${nanoid()}`, type }]);
    };
    socket.on("sync:reaction", handler);
    return () => { socket.off("sync:reaction", handler); };
  }, []);

  // â”€â”€ Prefetch next track in queue while current track plays â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  useEffect(() => {
    if (!party?.currentTrack || !party.queue.length) return;
    const currentIdx = party.queue.findIndex(t => t.id === party.currentTrack?.id);
    const nextTrack = party.queue[currentIdx + 1];
    if (nextTrack && nextTrack.type !== 'youtube' && nextTrack.url) {
      audioEngine.prefetch(nextTrack.id, nextTrack.url);
    }
  }, [party?.currentTrack?.id]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (party?.currentTrack && party.playbackState.playing && !isLocalPaused && !isHost) {
        // Continuous adaptive sync for listeners
        const playback = party.playbackState;
        if (party.currentTrack.type === 'youtube' && ytPlayerRef.current) {
          const serverPos = (playback.position + (syncEngine.getCorrectedTime() - playback.timestamp)) / 1000;
          const currentYTTime = ytPlayerRef.current.getCurrentTime();
          if (Math.abs(currentYTTime - serverPos) > 2.0) {
            ytPlayerRef.current.seekTo(serverPos, true);
          }
        } else {
          const localPos = audioEngine.getPosition() * 1000;
          const serverPos = playback.position + (syncEngine.getCorrectedTime() - playback.timestamp);
          const drift = Math.abs(localPos - serverPos);
          audioEngine.syncTo(serverPos / 1000, drift);
        }
      }

      if (party?.currentTrack) {
        setCurrentTime(getPlaybackSeconds(party.playbackState, isLocalPaused));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [party, isLocalPaused, isHost]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isHost || !party || !party.currentTrack) return;
    const pos = parseFloat(e.target.value);
    syncEngine.socket.emit("sync:seek", { code: party.code, position_ms: pos * 1000 });
    
    if (party.currentTrack.type === 'youtube' && ytPlayerRef.current) {
      ytPlayerRef.current.seekTo(pos, true);
    } else {
      audioEngine.seek(pos);
    }
  };

  useEffect(() => {
    if (!userName) return;

    const urlParams = new URLSearchParams(window.location.search);
    const joinParam = urlParams.get("join");
    if (joinParam && !party) {
      joinSession(joinParam);
    }

    const socket = syncEngine.socket;

    socket.on("party:update", async (updatedParty: Party) => {
      setParty(updatedParty);
      
      const currentTrack = updatedParty.currentTrack;
      const playback: PlaybackState = updatedParty.playbackState;

      if (currentTrack) {
        setDuration(currentTrack.duration);

        if (currentTrack.type === "youtube") {
          // Switch to YouTube mode
          audioEngine.stop();
          
          if (ytPlayerRef.current) {
            const serverPos = (playback.position + (playback.playing ? (syncEngine.getCorrectedTime() - playback.timestamp) : 0)) / 1000;
            const currentYTTime = ytPlayerRef.current.getCurrentTime();
            
            if (Math.abs(currentYTTime - serverPos) > 1.0 && playback.playing && !isLocalPaused) {
              ytPlayerRef.current.seekTo(serverPos, true);
            }

            if (playback.playing && !isLocalPaused) {
              ytPlayerRef.current.playVideo();
            } else {
              ytPlayerRef.current.pauseVideo();
            }
          }
        } else {
          // â”€â”€ Direct Audio mode (MP3/WAV uploads) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
          if (ytPlayerRef.current) ytPlayerRef.current.pauseVideo();

          const now = syncEngine.getCorrectedTime();

          if (audioEngine.trackId !== currentTrack.id) {
            // New track â€” load, seek to exact server position, play
            const expectedStart = syncEngine.getExpectedPosition(
              playback.position,
              playback.scheduledStartTime ?? playback.timestamp,
              playback.playing
            );

            const streamUrl = await audioEngine.loadAndBuffer(currentTrack.id, currentTrack.url);
            audioEngine.play(streamUrl, currentTrack.id, Math.max(0, expectedStart), () => {
              if (isHost && updatedParty.queue.length > 0) skipForward();
            }, () => {
              setToast(`Error playing ${currentTrack.name}.`);
            });
          }

          if (playback.playing && !isLocalPaused) {
            // Start continuous 500ms drift correction loop
            audioEngine.startSyncLoop(() =>
              syncEngine.getExpectedPosition(playback.position, playback.timestamp, true)
            );
            audioEngine.resume();
          } else {
            audioEngine.stopSyncLoop();
            audioEngine.pause();
          }
        }
      } else {
        audioEngine.stop();
        if (ytPlayerRef.current) ytPlayerRef.current.stopVideo();
      }
    });

    // sync:reaction is handled in a dedicated always-on effect below

    socket.on("error", (msg) => {
      alert(msg);
      if (view === "join") setView("landing");
    });

    socket.on("party:kicked", () => {
      alert("You have been removed from the session.");
      setParty(null);
      setView("landing");
      const url = new URL(window.location.href);
      url.searchParams.delete("join");
      window.history.pushState({}, "", url);
    });

    return () => {
      socket.off("party:update");
      socket.off("party:kicked");
      socket.off("error");
    };
  }, [userName, isLocalPaused, view, isHost, skipForward, joinSession]);

  const onAddToQueue = React.useCallback((track: Track) => {
    if (!party) return;
    const newQueue = [...party.queue, track];
    syncEngine.socket.emit("queue:update", { code: party.code, queue: newQueue });
    setToast(`${track.name} added to queue!`);
  }, [party]);

  const onPlayTrackNow = React.useCallback((track: Track) => {
    if (!party || !isHost) return;
    // Add to queue if not already there
    if (!party.queue.find(t => t.id === track.id)) {
      const newQueue = [...party.queue, track];
      syncEngine.socket.emit("queue:update", { code: party.code, queue: newQueue });
    }
    // Play the track
    syncEngine.socket.emit("sync:play", { code: party.code, track_id: track.id, position_ms: 0 });
  }, [party, isHost]);

  const onRemoveTrack = React.useCallback(async (track: Track) => {
    await deleteTrackOffline(track.id);
    refreshLibrary();
    setToast(`${track.name} removed from library!`);
  }, []);

  const togglePlayback = () => {
    if (!party || !party.currentTrack) return;
    if (party.playbackState.playing) {
      syncEngine.socket.emit("sync:pause", { code: party.code });
    } else {
      let pos = 0;
      if (party.currentTrack.type === 'youtube' && ytPlayerRef.current) {
        pos = ytPlayerRef.current.getCurrentTime() * 1000;
      } else {
        pos = audioEngine.getPosition() * 1000;
      }
      syncEngine.socket.emit("sync:play", { code: party.code, track_id: party.currentTrack.id, position_ms: pos });
    }
  };

  useEffect(() => {
    const syncPlaybackClock = () => {
      if (!party?.currentTrack) {
        setCurrentTime(0);
        return;
      }

      setCurrentTime(getPlaybackSeconds(party.playbackState, isLocalPaused));
    };

    syncPlaybackClock();
    const interval = setInterval(syncPlaybackClock, 250);
    return () => clearInterval(interval);
  }, [party, isLocalPaused]);

  const toggleLocalPause = () => {
    const newState = !isLocalPaused;
    setIsLocalPaused(newState);
    if (newState) {
      audioEngine.pause();
      if (ytPlayerRef.current) ytPlayerRef.current.pauseVideo();
    } else if (party?.playbackState.playing) {
      if (party.currentTrack?.type === 'youtube' && ytPlayerRef.current) {
        ytPlayerRef.current.playVideo();
      } else {
        audioEngine.resume();
      }
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!party) return;
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;

      if (e.code === "Space" || e.key === "k") {
        e.preventDefault();
        if (isHost) {
          togglePlayback();
        } else {
          toggleLocalPause();
        }
      } else if (e.key === "j" || e.key === "ArrowLeft") {
        if (isHost) {
          skipBackward();
        }
      } else if (e.key === "l" || e.key === "ArrowRight") {
        if (isHost) {
          skipForward();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [party, isHost, skipBackward, skipForward, toggleLocalPause, togglePlayback]);

  const executeSearch = async (query: string) => {
    if (!query.trim()) return { success: false, error: "Search query is empty" };
    
    try {
      const isPlatformUrl = detectPlatformUrl(query.trim());
      const videoId = extractYouTubeId(query.trim());
      let searchRes;
      
      if (isPlatformUrl) {
        // Platform URL detected (Spotify, SoundCloud, etc) - use resolve-url endpoint
        searchRes = await fetch(`/api/music/resolve-url?url=${encodeURIComponent(query.trim())}`);
      } else if (videoId) {
        // Direct YouTube ID or URL detected
        searchRes = await fetch(`/api/youtube/search?q=${encodeURIComponent(videoId)}`);
      } else {
        // Regular search query
        searchRes = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}`);
      }
      
      const data = await searchRes.json();
      
      if (data.error) throw new Error(data.error);
      
      if (data.length > 0) {
        const top = data[0];
        const track: Track = {
          id: top.id,
          name: top.title,
          artist: top.artist,
          url: top.id,
          duration: top.duration,
          type: 'youtube',
          coverArt: top.thumbnail
        };
        await saveTrackOffline(track);
        refreshLibrary();
        return { success: true, error: null };
      }
      
      return { success: false, error: "No songs found for this query." };
    } catch (e: any) {
      console.error("Search Error:", e);
      return { success: false, error: e.message || "Failed to search" };
    }
  };

  const createParty = () => {
    setIsHost(true);
    syncEngine.socket.emit("party:create", { host_id: userId, host_name: userName }, (code: string) => {
      setView("host");
    });
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, onStatus: (s: any) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('audio/')) {
      onStatus({ loading: false, error: "Unsupported file type. Please upload an audio file." });
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      onStatus({ loading: false, error: "File too large. Max size is 20MB." });
      return;
    }

    onStatus({ loading: true, error: null });
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/music/upload", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }

      const track: Track = {
        ...data,
        ownerId: "local"
      };

      await saveTrackOffline(track);
      refreshLibrary();
      onStatus({ loading: false, error: null });
    } catch (err: any) {
      console.error("Upload error:", err);
      onStatus({ loading: false, error: err.message || "An unexpected error occurred during upload." });
    }
  };

  return (
    <div className="relative min-h-screen">
      <ThreeBackground />
      {party?.currentTrack?.type === 'youtube' && (
        <YouTubePlayer 
          videoId={party.currentTrack.url}
          playing={party.playbackState.playing && !isLocalPaused}
          position={party.playbackState.position / 1000}
          onReady={(p) => {
            ytPlayerRef.current = p;
          }}
          onEnd={() => {
            if (isHost && party.queue.length > 0) skipForward();
          }}
        />
      )}
      
      {showNamePrompt && (
        <NamePrompt onComplete={(name) => {
          setUserName(name);
          localStorage.setItem("syncwave_user", name);
          setShowNamePrompt(false);
          // Auto-join if user was in the middle of joining a session
          if (pendingJoinCode) {
            const code = pendingJoinCode;
            setPendingJoinCode(null);
            setIsHost(false);
            syncEngine.socket.emit("party:join", { code, listener_id: userId, listener_name: name }, (res: { success: boolean, error?: string }) => {
              if (res.success) {
                setView("listener");
                const url = new URL(window.location.href);
                url.searchParams.set("join", code);
                window.history.pushState({}, "", url);
              } else {
                setToast(res.error || `Session "${code}" not found. Check the code and try again.`);
              }
            });
          }
        }} />
      )}

      <ReactionOverlay reactions={reactions} />
      
      {party && (
        <div className="fixed top-8 right-8 z-[150]">
          <SyncStats />
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial="initial"
          animate="animate"
          exit="exit"
          variants={viewVariants}
          className="w-full h-full"
        >
          {view === "landing" && (
            <Landing 
              onHost={createParty} 
              onJoin={() => setView("join")} 
            />
          )}
          {view === "join" && <JoinView onBack={() => setView("landing")} onJoin={joinSession} />}
          {view === "host" && (
            <HostDashboard 
              party={party} 
              userName={userName} 
              duration={duration} 
              currentTime={currentTime} 
              onTogglePlayback={togglePlayback} 
              onSeek={handleSeek} 
              onLeaveParty={leaveSession}
              onShowToast={setToast}
              onLibraryView={() => setView("library")}
              onPlaylistsView={() => alert("Playlists are currently unavailable in session-only mode.")}
              onKickListener={kickListener}
              onMuteListener={muteListener}
              onBanListener={banListener}
              onRemoveFromQueue={removeFromQueue}
              onMoveInQueue={moveInQueue}
              onReorderQueue={onReorderQueue}
              onClearQueue={clearQueue}
              onPlayTrack={playTrackNow}
              onSkipForward={skipForward}
              onSkipBackward={skipBackward}
            />
          )}
          {view === "listener" && (
            <ListenerView 
               party={party} 
               isLocalPaused={isLocalPaused} 
               currentTime={currentTime} 
               duration={duration} 
               onToggleLocalPause={toggleLocalPause} 
               onLeave={leaveSession} 
               syncOffset={syncEngine.offset}
               onSuggestTrack={executeSearch}
            />
          )}
          {view === "library" && (
            <LibraryView 
              myLibrary={myLibrary} 
              onSearch={executeSearch} 
              onUpload={handleUpload} 
              onAddToQueue={onAddToQueue}
              onPlayTrackNow={onPlayTrackNow}
              onRemoveTrack={onRemoveTrack} 
              onBack={() => setView("host")} 
            />
          )}
        </motion.div>
      </AnimatePresence>
      <AnimatePresence>
        {toast && <Toast message={toast} onClose={() => setToast(null)} />}
      </AnimatePresence>
    </div>
  );
}
