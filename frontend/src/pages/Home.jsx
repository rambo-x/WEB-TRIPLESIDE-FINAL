import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtPrice } from "../lib/api";
import { useAudio } from "../context/AudioContext";
import { Play, Pause, ArrowRight, Music2, Sliders, ShoppingBag, Sparkles } from "lucide-react";

const HERO_IMG =
  "https://images.pexels.com/photos/10933686/pexels-photo-10933686.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=900&w=1600";

export default function Home() {
  const [songs, setSongs] = useState([]);
  const [gear, setGear] = useState([]);
  const [products, setProducts] = useState([]);
  const { current, playing, playTrack } = useAudio();

  useEffect(() => {
    let active = true;

    const loadHome = async () => {
      const [songsResult, gearResult, productsResult] = await Promise.allSettled([
        api.get("/songs"),
        api.get("/gear"),
        api.get("/products"),
      ]);

      if (!active) return;

      if (songsResult.status === "fulfilled") {
        const audioSongs = songsResult.value.data.filter((s) => s.track_type === "audio");
        setSongs(audioSongs.slice(0, 4));
      }
      if (gearResult.status === "fulfilled") {
        setGear(gearResult.value.data.slice(0, 6));
      }
      if (productsResult.status === "fulfilled") {
        setProducts(productsResult.value.data.slice(0, 3));
      }
    };

    loadHome();
    return () => { active = false; };
  }, []);

  return (
    <div data-testid="home-page" className="pb-32">
      {/* HERO */}
      <section className="relative min-h-[92vh] flex items-end overflow-hidden grain-overlay">
        <div
          className="absolute inset-0 bg-cover bg-center scale-105"
          style={{ backgroundImage: `url(${HERO_IMG})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-black/60 to-black/30" />
        <div className="absolute top-32 right-12 hidden lg:flex flex-col gap-1.5 opacity-70">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="eq-bar w-2 h-12 bg-[#e11d48] rounded-sm" />
          ))}
        </div>

        <div className="relative max-w-7xl mx-auto px-6 md:px-12 pb-24 pt-32 w-full fade-up">
          <div className="flex items-center gap-2 mb-6 text-[#e11d48]">
            <span className="w-2 h-2 rounded-full bg-[#e11d48] animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-[0.3em]">Recording · Mixing · Mastering</span>
          </div>
          <h1 className="font-[Outfit] text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-tighter leading-[0.95] max-w-4xl">
            Sound that <span className="italic font-light">moves</span>
            <br />
            from <span className="text-[#e11d48]">three sides.</span>
          </h1>
          <p className="mt-8 text-lg text-zinc-300 max-w-xl leading-relaxed">
            Production studio crafting music records, curating world-class gear,
            and delivering digital audio tools for forward-thinking creators.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              to="/shop"
              data-testid="hero-cta-shop"
              className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-[#e11d48] hover:bg-[#be123c] font-semibold text-white transition-all glow-brand"
            >
              Explore the Shop
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              to="/songs"
              data-testid="hero-cta-songs"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-full border border-white/20 hover:bg-white/5 font-semibold text-white transition-all"
            >
              <Play className="w-4 h-4" fill="white" />
              Listen to Catalog
            </Link>
          </div>
        </div>
      </section>

      {/* CATEGORIES BENTO */}
      <section className="max-w-7xl mx-auto px-6 md:px-12 mt-24">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            { to: "/songs", title: "Audio Catalog", desc: "Original releases & collaborations.", Icon: Music2, count: songs.length },
            { to: "/gear", title: "Studio Gear", desc: "The tools behind the sound.", Icon: Sliders, count: gear.length },
            { to: "/shop", title: "Digital Shop", desc: "Sample packs, presets & templates.", Icon: ShoppingBag, count: products.length },
          ].map((c, i) => (
            <Link
              key={c.to}
              to={c.to}
              data-testid={`category-${c.title.toLowerCase().replace(/\s/g, "-")}`}
              className="group relative overflow-hidden bg-[#0a0a0c] border border-white/10 rounded-2xl p-8 hover:border-[#e11d48]/50 hover:-translate-y-1 transition-all duration-300"
            >
              <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-[#e11d48]/10 blur-3xl group-hover:bg-[#e11d48]/20 transition-colors" />
              <c.Icon className="w-8 h-8 text-[#e11d48] mb-12" />
              <div className="text-xs font-mono text-zinc-500 mb-1">0{i + 1} / 03</div>
              <h3 className="font-[Outfit] text-2xl font-bold mb-2">{c.title}</h3>
              <p className="text-sm text-zinc-400 mb-6">{c.desc}</p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-500">{c.count} items</span>
                <ArrowRight className="w-4 h-4 text-[#e11d48] group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* FEATURED SONGS */}
      <section className="max-w-7xl mx-auto px-6 md:px-12 mt-32">
        <div className="flex items-end justify-between mb-10">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#e11d48] mb-3">Now Playing</div>
            <h2 className="font-[Outfit] text-4xl md:text-5xl font-bold tracking-tight">Featured Songs</h2>
          </div>
          <Link to="/songs" className="text-sm text-zinc-400 hover:text-white flex items-center gap-2">
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {songs.map((s) => {
            const isCurrent = current?.id === s.id;
            return (
              <div
                key={s.id}
                data-testid={`featured-song-${s.id}`}
                className="group bg-[#0a0a0c] border border-white/10 rounded-xl overflow-hidden hover:border-white/20 transition-all"
              >
                <div className="relative aspect-square overflow-hidden">
                  <img src={s.cover_url} alt={s.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  <button
                    data-testid={`play-song-${s.id}`}
                    onClick={() => playTrack(s)}
                    className="absolute bottom-3 right-3 w-12 h-12 rounded-full bg-[#e11d48] flex items-center justify-center opacity-0 group-hover:opacity-100 hover:scale-110 transition-all glow-brand"
                  >
                    {isCurrent && playing ? <Pause className="w-4 h-4" fill="white" /> : <Play className="w-4 h-4 ml-0.5" fill="white" />}
                  </button>
                </div>
                <div className="p-4">
                  <div className="text-[10px] font-mono text-[#e11d48] uppercase tracking-wider mb-1">{s.genre}</div>
                  <div className="font-semibold truncate">{s.title}</div>
                  <div className="text-xs text-zinc-400 truncate">{s.artist}</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* GEAR PREVIEW */}
      <section className="max-w-7xl mx-auto px-6 md:px-12 mt-32">
        <div className="flex items-end justify-between mb-10">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#e11d48] mb-3">TripleSide Studio</div>
            <h2 className="font-[Outfit] text-4xl md:text-5xl font-bold tracking-tight">Tools of the Trade</h2>
          </div>
          <Link to="/gear" className="text-sm text-zinc-400 hover:text-white flex items-center gap-2">
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
          {gear.slice(0, 6).map((g) => (
            <div
              key={g.id}
              data-testid={`featured-gear-${g.id}`}
              className="group relative aspect-[4/5] overflow-hidden rounded-xl border border-white/10 hover:border-white/20 transition-all"
            >
              <img src={g.image_url} alt={g.name} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-5">
                <div className="text-[10px] font-mono text-[#e11d48] uppercase tracking-wider mb-1">{g.category}</div>
                <div className="font-bold text-lg leading-tight">{g.name}</div>
                <div className="text-xs text-zinc-300 mt-0.5">{g.brand}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* DIGITAL PRODUCTS */}
      <section className="max-w-7xl mx-auto px-6 md:px-12 mt-32">
        <div className="flex items-end justify-between mb-10">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#e11d48] mb-3">Digital Goods</div>
            <h2 className="font-[Outfit] text-4xl md:text-5xl font-bold tracking-tight">Shop the Sound</h2>
          </div>
          <Link to="/shop" className="text-sm text-zinc-400 hover:text-white flex items-center gap-2">
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {products.map((p) => (
            <Link
              to={`/shop/${p.id}`}
              key={p.id}
              data-testid={`featured-product-${p.id}`}
              className="group bg-[#0a0a0c] border border-white/10 rounded-2xl overflow-hidden hover:border-[#e11d48]/40 transition-all"
            >
              <div className="aspect-square overflow-hidden">
                <img src={p.image_url} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
              </div>
              <div className="p-5 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-[10px] font-mono text-[#e11d48] uppercase tracking-wider mb-1">{p.category}</div>
                  <div className="font-semibold truncate">{p.name}</div>
                </div>
                <div className="font-[Outfit] text-xl font-bold flex-shrink-0 ml-3">{fmtPrice(p.price)}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-6 md:px-12 mt-32">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0c] p-12 md:p-20">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-[#e11d48]/20 blur-3xl" />
          <Sparkles className="w-8 h-8 text-[#e11d48] mb-6 relative" />
          <h3 className="font-[Outfit] text-3xl md:text-5xl font-bold tracking-tight max-w-2xl relative">
            Ready to make your next record?
          </h3>
          <p className="mt-4 text-zinc-400 max-w-xl relative">
            Book the studio, license a sample pack, or just nerd out about gear. We&apos;re here for it.
          </p>
          <div className="mt-8 flex gap-3 relative">
            <Link to="/shop" className="px-7 py-3.5 rounded-full bg-[#e11d48] font-semibold hover:bg-[#be123c] transition-colors">
              Browse Shop
            </Link>
            <a href="https://api.whatsapp.com/send/?phone=6287708772747&text&type=phone_number&app_absent=0" className="px-7 py-3.5 rounded-full border border-white/20 font-semibold hover:bg-white/5 transition-colors">
              Contact Studio
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
