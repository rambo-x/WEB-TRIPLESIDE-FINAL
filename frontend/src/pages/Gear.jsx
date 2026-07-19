import React, { useEffect, useState, useMemo } from "react";
import { api } from "../lib/api";

export default function Gear() {
  const [gear, setGear] = useState([]);
  const [cat, setCat] = useState("All");

  useEffect(() => {
    api.get("/gear").then((r) => setGear(r.data)).catch(() => setGear([]));
  }, []);

  const categories = useMemo(() => ["All", ...Array.from(new Set(gear.map((g) => g.category)))], [gear]);
  const filtered = cat === "All" ? gear : gear.filter((g) => g.category === cat);

  return (
    <div data-testid="gear-page" className="max-w-7xl mx-auto px-6 md:px-12 pt-32 pb-32">
      <div className="mb-12 fade-up">
        <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#e11d48] mb-3">Catalog · 02</div>
        <h1 className="font-[Outfit] text-5xl md:text-7xl font-black tracking-tighter">My Studio Gear</h1>
        <p className="text-zinc-400 mt-4 max-w-xl">Every piece of gear we trust to shape sound at TripleSide Studio.</p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 mb-10">
        {categories.map((c) => (
          <button
            key={c}
            data-testid={`gear-cat-${c}`}
            onClick={() => setCat(c)}
            className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              cat === c ? "bg-[#e11d48] text-white" : "bg-white/5 text-zinc-400 hover:bg-white/10"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((g) => (
          <article
            key={g.id}
            data-testid={`gear-card-${g.id}`}
            className="group bg-[#0a0a0c] border border-white/10 rounded-2xl overflow-hidden hover:border-white/25 hover:-translate-y-1 transition-all duration-300"
          >
            <div className="relative aspect-[4/3] overflow-hidden bg-black">
              <img src={g.image_url} alt={g.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" />
              <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur text-[10px] font-mono uppercase tracking-wider text-[#e11d48]">
                {g.category}
              </div>
            </div>
            <div className="p-6">
              <div className="text-xs text-zinc-400 mb-1">{g.brand}</div>
              <h3 className="font-[Outfit] text-xl font-bold mb-3 tracking-tight">{g.name}</h3>
              <p className="text-sm text-zinc-400 leading-relaxed mb-4 line-clamp-2">{g.description}</p>
              <ul className="space-y-1.5">
                {(g.specs || []).slice(0, 3).map((sp, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-zinc-300 font-mono">
                    <span className="w-1 h-1 rounded-full bg-[#e11d48]" />
                    {sp}
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
        {filtered.length === 0 && <div className="col-span-full text-center py-20 text-zinc-500">No gear.</div>}
      </div>
    </div>
  );
}
