import React, { useState } from "react";
import { NavLink, Link, useLocation, useNavigate } from "react-router-dom";
import { Disc3, Music2, Sliders, ShoppingBag, User, LogOut, ChevronDown, LayoutDashboard, BookOpen } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const links = [
  { to: "/", label: "Home", icon: Disc3 },
  { to: "/songs", label: "Audio", icon: Music2 },
  { to: "/gear", label: "Gear", icon: Sliders },
  { to: "/shop", label: "Shop", icon: ShoppingBag },
  { to: "/blog", label: "Blog", icon: BookOpen },
];

export default function Navbar() {
  const loc = useLocation();
  const nav = useNavigate();
  const { user, isCustomer, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    setMenuOpen(false);
    nav("/");
  };

  return (
    <header
      data-testid="main-navbar"
      className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-black/60 border-b border-white/10"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-12 h-16 flex items-center justify-between">
        <Link to="/" data-testid="brand-link" className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-md bg-[#e11d48] flex items-center justify-center group-hover:rotate-12 transition-transform">
            <span className="font-mono text-[10px] font-bold">3S</span>
          </div>
          <span className="font-[Outfit] text-base md:text-lg font-bold tracking-tight">
            TripleSide<span className="text-[#e11d48]"> Studio</span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {links.map((l) => {
            const Icon = l.icon;
            const active = loc.pathname === l.to;
            return (
              <NavLink
                key={l.to}
                to={l.to}
                data-testid={`nav-${l.label.toLowerCase()}`}
                className={`px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 transition-colors ${
                  active ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <Icon className="w-4 h-4" />
                {l.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          {!user && (
            <>
              <Link
                to="/login"
                data-testid="navbar-login"
                className="hidden sm:inline-flex px-4 py-2 rounded-full text-sm font-medium text-zinc-300 hover:text-white hover:bg-white/5"
              >
                Login
              </Link>
              <Link
                to="/register"
                data-testid="navbar-register"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-[#e11d48] hover:bg-[#be123c] text-white transition-colors"
              >
                <User className="w-3.5 h-3.5" />
                Register
              </Link>
            </>
          )}

          {isCustomer && (
            <div className="relative">
              <button
                data-testid="account-menu-btn"
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 px-3 py-2 rounded-full border border-white/15 hover:border-white/30 transition-colors"
              >
                <div className="w-6 h-6 rounded-full bg-[#e11d48] flex items-center justify-center text-[10px] font-bold">
                  {(user.profile.name || "U").slice(0, 1).toUpperCase()}
                </div>
                <span className="hidden sm:inline text-sm font-medium max-w-[80px] truncate">
                  {user.profile.name}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-56 bg-[#0a0a0c] border border-white/10 rounded-xl p-2 z-50 shadow-2xl">
                    <Link
                      to="/dashboard"
                      onClick={() => setMenuOpen(false)}
                      data-testid="account-menu-dashboard"
                      className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm hover:bg-white/5"
                    >
                      <LayoutDashboard className="w-4 h-4" />
                      My Dashboard
                    </Link>
                    <button
                      onClick={handleLogout}
                      data-testid="account-menu-logout"
                      className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm hover:bg-white/5 text-red-400"
                    >
                      <LogOut className="w-4 h-4" />
                      Logout
                    </button>
                    <div className="border-t border-white/5 mt-1 pt-2 px-3 pb-1">
                      <div className="text-[10px] text-zinc-500 truncate">{user.profile.email || user.profile.phone}</div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {user?.kind === "admin" && (
            <Link
              to="/admin"
              data-testid="admin-link"
              className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border border-[#e11d48] text-[#e11d48] hover:bg-[#e11d48]/10 transition-colors"
            >
              Admin
            </Link>
          )}
        </div>
      </div>

      {/* Mobile nav */}
      <nav className="md:hidden flex items-center justify-around border-t border-white/5 py-2">
        {links.map((l) => {
          const Icon = l.icon;
          const active = loc.pathname === l.to;
          return (
            <NavLink
              key={l.to}
              to={l.to}
              data-testid={`mnav-${l.label.toLowerCase()}`}
              className={`flex flex-col items-center gap-1 px-3 py-1 ${
                active ? "text-[#e11d48]" : "text-zinc-400"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[10px] font-semibold">{l.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </header>
  );
}
