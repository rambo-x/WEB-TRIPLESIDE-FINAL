import React from "react";
import { Instagram, Youtube, Mail } from "lucide-react";

export default function Footer() {
  return (
    <footer data-testid="main-footer" className="border-t border-white/5 mt-32 bg-[#050505]">
      <div className="max-w-7xl mx-auto px-6 md:px-12 py-16 grid md:grid-cols-4 gap-12">
        <div className="md:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-md bg-[#e11d48] flex items-center justify-center">
              <span className="font-mono text-[10px] font-bold">3S</span>
            </div>
            <span className="font-[Outfit] text-lg font-bold">TripleSide<span className="text-[#e11d48]"> Studio</span></span>
          </div>
          <p className="text-zinc-400 text-sm max-w-md leading-relaxed">
            A modern music production studio crafting cinematic sound, premium gear curation,
            and digital audio products for forward-thinking creators.
          </p>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-4">Studio</div>
          <ul className="space-y-2 text-sm text-zinc-300">
            <li>Recording</li>
            <li>Mixing &amp; Mastering</li>
            <li>Production</li>
          </ul>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-4">Connect</div>
          <div className="flex gap-3">
            <a href="https://www.instagram.com/tripleside_studio?igsh=ZXNsa3o5YTc2Ymdr&utm_source=qr" className="w-9 h-9 rounded-full border border-white/10 flex items-center justify-center hover:border-[#e11d48] hover:text-[#e11d48] transition-colors"><Instagram className="w-4 h-4" /></a>
            <a href="https://www.youtube.com/@tripleside_music_corner/featured" className="w-9 h-9 rounded-full border border-white/10 flex items-center justify-center hover:border-[#e11d48] hover:text-[#e11d48] transition-colors"><Youtube className="w-4 h-4" /></a>
            <a href="#" className="w-9 h-9 rounded-full border border-white/10 flex items-center justify-center hover:border-[#e11d48] hover:text-[#e11d48] transition-colors"><Mail className="w-4 h-4" /></a>
          </div>
        </div>
      </div>
      <div className="border-t border-white/5 py-6 text-center text-xs text-zinc-500">
        © {new Date().getFullYear()} TripleSide Studio — Crafted with sound.
      </div>
    </footer>
  );
}
