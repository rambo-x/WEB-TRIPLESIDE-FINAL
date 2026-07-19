import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../lib/api";
import { ArrowLeft, Calendar, User } from "lucide-react";

export default function BlogPost() {
  const { slug } = useParams();
  const nav = useNavigate();
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get(`/blog/${slug}`)
      .then((r) => setPost(r.data))
      .catch(() => nav("/blog"))
      .finally(() => setLoading(false));
  }, [slug, nav]);

  if (loading) return <div className="pt-40 text-center text-zinc-500">Loading...</div>;
  if (!post) return null;

  return (
    <article data-testid="blog-post-page" className="max-w-3xl mx-auto px-6 md:px-12 pt-28 pb-32">
      <Link to="/blog" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-8">
        <ArrowLeft className="w-4 h-4" /> Back to Blog
      </Link>

      {post.featured_image && (
        <div className="rounded-2xl overflow-hidden border border-white/10 aspect-[16/9] bg-black mb-10">
          <img src={post.featured_image} alt={post.title} className="w-full h-full object-cover" />
        </div>
      )}

      <div className="flex items-center gap-4 text-xs font-mono text-zinc-500 mb-4">
        <span className="inline-flex items-center gap-1.5"><Calendar className="w-3 h-3" />{(post.published_at || post.created_at || "").slice(0, 10)}</span>
        <span className="inline-flex items-center gap-1.5"><User className="w-3 h-3" />{post.author}</span>
      </div>

      <h1 className="font-[Outfit] text-4xl md:text-6xl font-black tracking-tighter mb-6">{post.title}</h1>

      {post.excerpt && (
        <p className="text-lg text-zinc-300 leading-relaxed mb-10 border-l-2 border-[#e11d48] pl-5 italic">
          {post.excerpt}
        </p>
      )}

      <div className="flex gap-1.5 flex-wrap mb-10">
        {(post.tags || []).map((t) => (
          <span key={t} className="text-[10px] font-mono uppercase tracking-wider px-3 py-1 rounded-full bg-white/5 text-zinc-300 border border-white/10">
            #{t}
          </span>
        ))}
      </div>

      <div data-testid="post-content" className="prose-blog">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.content}</ReactMarkdown>
      </div>
    </article>
  );
}
