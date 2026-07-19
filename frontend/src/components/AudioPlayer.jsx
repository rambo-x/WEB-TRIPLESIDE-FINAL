import React from "react";
import { useAudio } from "../context/AudioContext";
import { Play, Pause, X } from "lucide-react";

const fmt = (s) => {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
};

export default function AudioPlayer() {
  const { current, playing, progress, duration, toggle, seek, stop } = useAudio();
  if (!current) return null;
  const pct = duration ? (progress / duration) * 100 : 0;

  return (
    <div
      data-testid="global-audio-player"
      className="fixed bottom-0 left-0 right-0 z-50 bg-[#0a0a0c]/95 backdrop-blur-xl border-t border-white/10"
    >
      <div className="max-w-7xl mx-auto px-4 md:px-12 py-3 flex items-center gap-4">
        <img
          src={current.cover_url}
          alt={current.title}
          className="w-12 h-12 rounded-md object-cover hidden sm:block"
        />
        <div className="min-w-0 flex-shrink-0 w-32 md:w-48">
          <div className="text-sm font-semibold truncate">{current.title}</div>
          <div className="text-xs text-zinc-400 truncate">{current.artist}</div>
        </div>
        <button
          data-testid="player-toggle"
          onClick={toggle}
          className="w-10 h-10 rounded-full bg-[#e11d48] flex items-center justify-center flex-shrink-0 hover:bg-[#be123c] transition-colors"
        >
          {playing ? <Pause className="w-4 h-4" fill="white" /> : <Play className="w-4 h-4 ml-0.5" fill="white" />}
        </button>
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <span className="text-[11px] font-mono text-zinc-400 hidden sm:block">{fmt(progress)}</span>
          <div
            className="relative flex-1 h-1.5 bg-white/10 rounded-full cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = (e.clientX - rect.left) / rect.width;
              seek(x * duration);
            }}
          >
            <div className="absolute inset-y-0 left-0 bg-[#e11d48] rounded-full" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[11px] font-mono text-zinc-400 hidden sm:block">{fmt(duration)}</span>
        </div>
        <button
          data-testid="player-close"
          onClick={stop}
          className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-colors flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
