import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <main className="min-h-[75vh] flex items-center justify-center px-6 pt-24 pb-20">
      <div className="max-w-xl text-center">
        <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#e11d48] mb-4">
          Error 404
        </div>
        <h1 className="font-[Outfit] text-5xl md:text-7xl font-black tracking-tighter">
          Page not found.
        </h1>
        <p className="mt-5 text-zinc-400">
          The page may have moved, or the address may be incorrect.
        </p>
        <Link
          to="/"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#e11d48] px-6 py-3 font-semibold text-white hover:bg-[#be123c]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </Link>
      </div>
    </main>
  );
}
