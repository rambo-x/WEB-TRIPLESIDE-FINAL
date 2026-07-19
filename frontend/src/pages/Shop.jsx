import React, { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { api, fmtPrice } from "../lib/api";

export default function Shop() {
  const [products, setProducts] = useState([]);
  const [cat, setCat] = useState("All");

  useEffect(() => {
    api.get("/products").then((r) => setProducts(r.data)).catch(() => setProducts([]));
  }, []);

  const categories = useMemo(() => ["All", ...Array.from(new Set(products.map((p) => p.category)))], [products]);
  const filtered = cat === "All" ? products : products.filter((p) => p.category === cat);

  return (
    <div data-testid="shop-page" className="max-w-7xl mx-auto px-6 md:px-12 pt-32 pb-32">
      <div className="mb-12 fade-up">
        <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#e11d48] mb-3">Catalog · 03</div>
        <h1 className="font-[Outfit] text-5xl md:text-7xl font-black tracking-tighter">Digital Shop</h1>
        <p className="text-zinc-400 mt-4 max-w-xl">VSTI, sample packs, preset banks, and project templates built by us, for you.</p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 mb-10">
        {categories.map((c) => (
          <button
            key={c}
            data-testid={`shop-cat-${c}`}
            onClick={() => setCat(c)}
            className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
              cat === c ? "bg-[#e11d48] text-white" : "bg-white/5 text-zinc-400 hover:bg-white/10"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((p) => (
          <Link
            to={`/shop/${p.id}`}
            key={p.id}
            data-testid={`product-card-${p.id}`}
            className="group bg-[#0a0a0c] border border-white/10 rounded-2xl overflow-hidden hover:border-[#e11d48]/40 hover:-translate-y-1 transition-all duration-300"
          >
            <div className="aspect-square overflow-hidden bg-black">
              <img src={p.image_url} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
            </div>
            <div className="p-5">
              <div className="flex items-center gap-2 mb-1.5">
                <div className="text-[10px] font-mono text-[#e11d48] uppercase tracking-wider">{p.category}</div>
                {p.is_free && (
                  <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                    Free
                  </span>
                )}
              </div>
              <h3 className="font-[Outfit] text-lg font-bold mb-2 tracking-tight">{p.name}</h3>
              <p className="text-xs text-zinc-400 line-clamp-2 mb-4">{p.description}</p>
              <div className="flex items-center justify-between">
                <span className="font-[Outfit] text-2xl font-black">
                  {p.is_free ? <span className="text-emerald-400">Free</span> : fmtPrice(p.price)}
                </span>
                <span className="text-xs font-semibold text-[#e11d48] group-hover:translate-x-1 transition-transform">View →</span>
              </div>
            </div>
          </Link>
        ))}
        {filtered.length === 0 && <div className="col-span-full text-center py-20 text-zinc-500">No products.</div>}
      </div>
    </div>
  );
}
