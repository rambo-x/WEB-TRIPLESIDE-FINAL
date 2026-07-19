import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { ArrowRight, Calendar } from "lucide-react";

export default function Blog() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/blog")
      .then((r) => setPosts(r.data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div data-testid="blog-page" className="max-w-7xl mx-auto px-6 md:px-12 pt-32 pb-32">
      <div className="mb-16 fade-up">
        <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#e11d48] mb-3">Journal</div>
        <h1 className="font-[Outfit] text-5xl md:text-7xl font-black tracking-tighter">Blog</h1>
        <p className="text-zinc-400 mt-4 max-w-xl">
          Production tips, gear deep dives, and behind-the-scenes from TripleSide Studio.
        </p>
      </div>

      {loading && <div className="text-center py-20 text-zinc-500">Loading...</div>}

      {!loading && posts.length === 0 && (
        <div className="text-center py-20 text-zinc-500">No posts yet. Check back soon.</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {posts.map((p) => (
          <Link
            key={p.id}
            to={`/blog/${p.slug}`}
            data-testid={`blog-card-${p.slug}`}
            className="group flex flex-col bg-[#0a0a0c] border border-white/10 rounded-2xl overflow-hidden hover:border-[#e11d48]/40 hover:-translate-y-1 transition-all duration-300"
          >
            {p.featured_image && (
              <div className="aspect-[16/10] overflow-hidden bg-black">
                <img
                  src={p.featured_image}
                  alt={p.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                />
              </div>
            )}
            <div className="p-6 flex-1 flex flex-col">
              <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500 mb-3">
                <Calendar className="w-3 h-3" />
                {(p.published_at || p.created_at || "").slice(0, 10)}
              </div>
              <h2 className="font-[Outfit] text-xl font-bold tracking-tight mb-2 leading-snug">{p.title}</h2>
              <p className="text-sm text-zinc-400 line-clamp-2 mb-4 flex-1">{p.excerpt}</p>
              <div className="flex items-center justify-between">
                <div className="flex gap-1.5 flex-wrap">
                  {(p.tags || []).slice(0, 2).map((t) => (
                    <span key={t} className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/5 text-zinc-400">
                      {t}
                    </span>
                  ))}
                </div>
                <ArrowRight className="w-4 h-4 text-[#e11d48] group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
