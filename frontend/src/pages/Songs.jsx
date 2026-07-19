import React, { useEffect, useState, useMemo } from "react";
import { api } from "../lib/api";
import { useAudio } from "../context/AudioContext";
import { Play, Pause, Search, Youtube, Music as MusicIcon } from "lucide-react";

// Convert various YouTube URLs to embeddable form
const ytEmbed = (url) => {
  if (!url) return "";
  if (url.includes("/embed/")) return url;
  const m = url.match(/(?:youtu\.be\/|v=)([\w-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : url;
};

// Convert Spotify URL to embed URL
const spEmbed = (url) => {
  if (!url) return "";
  if (url.includes("/embed/")) return url;
  return url.replace("open.spotify.com/", "open.spotify.com/embed/");
};

export default function Songs() {
  const [songs, setSongs] = useState([]);
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState("All");
  const [expanded, setExpanded] = useState(null); // song id whose embed is open
  const { current, playing, playTrack } = useAudio();

  useEffect(() => {
    api.get("/songs").then((r) => setSongs(r.data)).catch(() => setSongs([]));
  }, []);

  const genres = useMemo(() => ["All", ...Array.from(new Set(songs.map((s) => s.genre)))], [songs]);
  const filtered = songs.filter((s) => {
    const matchQ = `${s.title} ${s.artist}`.toLowerCase().includes(q.toLowerCase());
    const matchG = genre === "All" || s.genre === genre;
    return matchQ && matchG;
  });

  const handleClick = (s) => {
    const type = s.track_type || "audio";
    if (type === "audio") {
      playTrack(s);
    } else {
      setExpanded((e) => (e === s.id ? null : s.id));
    }
  };

  const TypeBadge = ({ t }) => {
    if (t === "youtube") {
      return <Youtube className="w-3.5 h-3.5 text-red-500" title="YouTube" />;
    }
    if (t === "spotify") {
      return <MusicIcon className="w-3.5 h-3.5 text-emerald-400" title="Spotify" />;
    }
    return null;
  };

  return (
    <div data-testid="songs-page" className="max-w-7xl mx-auto px-6 md:px-12 pt-32 pb-32">
      <div className="mb-12 fade-up">
        <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#e11d48] mb-3">Catalog · 01</div>
        <h1 className="font-[Outfit] text-5xl md:text-7xl font-black tracking-tighter">Audio Catalog</h1>
        <p className="text-zinc-400 mt-4 max-w-xl">
          Original productions, live cuts, and streamable covers. Plays inline below.
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-10">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            data-testid="songs-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by title or artist..."
            className="w-full bg-[#0a0a0c] border border-white/10 rounded-full pl-11 pr-4 py-3 text-sm focus:outline-none focus:border-[#e11d48]"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {genres.map((g) => (
            <button
              key={g}
              data-testid={`genre-filter-${g}`}
              onClick={() => setGenre(g)}
              className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                genre === g ? "bg-[#e11d48] text-white" : "bg-white/5 text-zinc-400 hover:bg-white/10"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-12 gap-4 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 border-b border-white/5">
          <div className="col-span-1">#</div>
          <div className="col-span-6 md:col-span-5">Title</div>
          <div className="hidden md:block col-span-3">Genre</div>
          <div className="col-span-3 md:col-span-2">Year</div>
          <div className="col-span-2 md:col-span-1 text-right">Time</div>
        </div>

        {filtered
  .filter((s) => s.track_type !== "youtube")
  .map((s, i) => {
          const type = s.track_type || "audio";
          const isAudio = type === "audio";
          const isCurrent = isAudio && current?.id === s.id;
          const isExpanded = expanded === s.id;
          return (
            <div key={s.id}>
              <button
                data-testid={`song-row-${s.id}`}
                onClick={() => handleClick(s)}
                className={`group w-full grid grid-cols-12 gap-4 items-center px-4 py-3 rounded-lg text-left transition-colors ${
                  isCurrent || isExpanded ? "bg-white/5 border-l-2 border-[#e11d48]" : "hover:bg-white/5"
                }`}
              >
                <div className="col-span-1 flex items-center relative">
                  <div className="w-8 h-8 rounded-full bg-[#e11d48] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    {isAudio && isCurrent && playing ? (
                      <Pause className="w-3 h-3" fill="white" />
                    ) : (
                      <Play className="w-3 h-3 ml-0.5" fill="white" />
                    )}
                  </div>
                  <div className="w-8 text-xs font-mono text-zinc-500 group-hover:hidden absolute">
                    {(i + 1).toString().padStart(2, "0")}
                  </div>
                </div>
                <div className="col-span-6 md:col-span-5 flex items-center gap-3 min-w-0">
                  <img src={s.cover_url} alt={s.title} className="w-11 h-11 rounded object-cover flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold truncate ${isCurrent || isExpanded ? "text-[#e11d48]" : ""}`}>
                        {s.title}
                      </span>
                      <TypeBadge t={type} />
                    </div>
                    <div className="text-xs text-zinc-400 truncate">{s.artist}</div>
                  </div>
                </div>
                <div className="hidden md:block col-span-3 text-xs text-zinc-400 font-mono uppercase">{s.genre}</div>
                <div className="col-span-3 md:col-span-2 text-xs text-zinc-400 font-mono">{s.release_year || "—"}</div>
                <div className="col-span-2 md:col-span-1 text-xs text-zinc-400 font-mono text-right">{s.duration}</div>
              </button>

              {isExpanded && type === "youtube" && (
                <div data-testid={`youtube-embed-${s.id}`} className="ml-12 mr-2 my-2 rounded-xl overflow-hidden border border-white/10 aspect-video bg-black">
                  <iframe
                    src={ytEmbed(s.embed_url)}
                    title={s.title}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              )}
              {isExpanded && type === "spotify" && (
                <div data-testid={`spotify-embed-${s.id}`} className="ml-12 mr-2 my-2 rounded-xl overflow-hidden border border-white/10">
                  <iframe
                    src={spEmbed(s.embed_url)}
                    title={s.title}
                    className="w-full"
                    height="152"
                    frameBorder="0"
                    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                    loading="lazy"
                  />
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && <div className="text-center py-20 text-zinc-500">No songs found.</div>}
      </div>
      {/* ========================= */}
{/* YOUTUBE SECTION */}
{/* ========================= */}

<div className="mt-20">

  <h2 className="text-3xl font-bold mb-6">
    Youtube Portfolio
  </h2>

  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-10">

    {filtered
      .filter((s) => s.track_type === "youtube")
      .map((s) => (

      <div key={s.id} className="w-full">

  <h3 className="text-xl mb-4 truncate">
    {s.title}
  </h3>

  <div className="aspect-video w-full overflow-hidden rounded-2xl">

    <iframe
      width="100%"
      height="100%"
      src={ytEmbed(s.embed_url)}
      title={s.title}
      frameBorder="0"
      allowFullScreen
      className="w-full h-full"
    />

  </div>

</div>
    ))}

    </div>
</div>
</div>
  );
}

