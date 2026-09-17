/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React, { useEffect, useRef, useState, Suspense } from 'react';
import LeapLabAuthButton from './auth/LeapLabAuthButton';
import MyProjectsDashboard from './components/my-projects/MyProjectsDashboard';
import './components/my-projects/keyframes.css';
import { lazyWithRetry } from './utils/lazyWithRetry';

/** Hero card deck animation — lazy loaded for performance */
const HeroCardDeckAnimation = lazyWithRetry(() => import('./components/HeroCardDeckAnimation'), 'HeroCardDeckAnimation');

interface LandingPageProps {
  onSelect: (mode: 'intermediate' | 'junior' | 'python' | 'appinventor' | 'vision3d' | any) => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onSelect }) => {
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });
  const [showSplash, setShowSplash] = useState(() => {
    return !sessionStorage.getItem('splashCompleted');
  });
  const [activeSection, setActiveSection] = useState(0);
  const [highlightCards, setHighlightCards] = useState(false);
  const [scanIndex, setScanIndex] = useState(-1);
  const scanIntervalRef = useRef<any>(null);
  const [activeTab, setActiveTab] = useState<'modules' | 'my-projects'>(() => {
    const saved = sessionStorage.getItem('landingActiveTab');
    if (saved === 'my-projects') return 'my-projects';
    return 'modules';
  });
  const showProjects = activeTab === 'my-projects';
  const [menuOpen, setMenuOpen] = useState(false);

  /* ── Card scan ── */
  const startCardScan = () => {
    // Clear any existing interval to prevent leaks and flickering
    if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);

    setHighlightCards(true);
    setScanIndex(0);
    let i = 0;
    scanIntervalRef.current = setInterval(() => {
      i = (i + 1) % 8;
      setScanIndex(i);
    }, 300);
  };

  const stopCardScan = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    setScanIndex(-1);
    setHighlightCards(false);
  };

  const handleCardClick = (action: () => void) => {
    stopCardScan();
    setHighlightCards(false);
    action();
  };

  const getCardClasses = (index: number, themeClasses: string) => {
    const isScanning = scanIndex >= 0;
    const isActive = scanIndex === index;

    let stateClasses = '';
    if (isScanning) {
      if (isActive) {
        stateClasses = '[transform:perspective(1000px)_translate3d(0,-8px,20px)_scale(1.05)_rotateX(4deg)!important] shadow-[0_0_0_3px_#6366F1,0_15px_35px_rgba(99,102,241,0.35),inset_0_2px_4px_rgba(255,255,255,1)!important] z-10 border-[rgba(99,102,241,0.5)]';
      } else {
        stateClasses = 'opacity-40 scale-95 shadow-none';
      }
    } else {
      if (highlightCards) {
        stateClasses = 'shadow-[0_0_0_2px_rgba(99,102,241,0.35),0_8px_20px_rgba(99,102,241,0.08)]';
      } else {
        stateClasses = 'shadow-sm';
      }
    }

    return `group relative flex flex-1 flex-col rounded-[20px] border border-slate-100/80 p-4 cursor-pointer overflow-hidden shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:border-slate-200/80 max-[768px]:p-3 max-[768px]:rounded-[14px] ${themeClasses} ${stateClasses}`;
  };

  /* ── Cleanup scan on unmount ── */
  useEffect(() => {
    return () => { if (scanIntervalRef.current) clearInterval(scanIntervalRef.current); };
  }, []);

  useEffect(() => {
    if (showSplash) {
      const timer = setTimeout(() => {
        setShowSplash(false);
        sessionStorage.setItem('splashCompleted', 'true');
      }, 3800);
      return () => clearTimeout(timer);
    }
  }, [showSplash]);

  useEffect(() => {
    (window as any).showComingSoon = (name: string) => {
      setToast({ message: `${name} is coming soon.`, visible: true });
      setTimeout(() => setToast({ message: '', visible: false }), 2500);
    };
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{
        __html: `
@keyframes splash-fade-out {
  0% { opacity: 1; visibility: visible; }
  100% { opacity: 0; visibility: hidden; }
}
@keyframes rocket-fly {
  0%   { transform: translateY(120vh) scale(1); opacity: 1; }
  35%  { transform: translateY(0) scale(1.1); opacity: 1; }
  50%  { transform: translateY(0) scale(1.1); opacity: 1; }
  85%  { transform: translateY(-120vh) scale(0.8); opacity: 1; }
  100% { transform: translateY(-120vh) scale(0.8); opacity: 0; }
}
@keyframes splash-text-reveal {
  0%   { opacity: 0; transform: scale(0.8) translateY(20px); filter: blur(10px); }
  100% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0px); }
}
@keyframes hero-reveal {
  0%   { opacity: 0; transform: translateY(30px) scale(0.95); filter: blur(5px); }
  100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0px); }
}
@keyframes float-slow {
  0%, 100% { transform: translate(0, 0) rotate(0deg); }
  33%       { transform: translate(30px, 50px) rotate(5deg); }
  66%       { transform: translate(-20px, 30px) rotate(-5deg); }
}
@keyframes float-glow {
  0%, 100% { transform: scale(1); opacity: 0.5; }
  50%       { transform: scale(1.1); opacity: 0.8; }
}
@keyframes hero3d-spin {
  0%   { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
@keyframes lp-toast-in {
  0%   { opacity: 0; transform: translateY(16px) scale(0.9); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

.animate-splash-fade-out { animation: splash-fade-out 0.8s ease-in-out 3s forwards; }
.animate-rocket-fly { animation: rocket-fly 2s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
.animate-splash-text-reveal { animation: splash-text-reveal 1.2s cubic-bezier(0.2, 0.8, 0.2, 1) 1.2s forwards; }
.animate-splash-text-reveal-delayed { animation: splash-text-reveal 1s cubic-bezier(0.2, 0.8, 0.2, 1) 1.8s forwards; }
.animate-hero-reveal { animation: hero-reveal 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
.animate-float-slow { animation: float-slow 10s ease-in-out infinite; }
.animate-float-glow { animation: float-glow 6s ease-in-out infinite; }
.animate-hero3d-spin { animation: hero3d-spin 0.8s linear infinite; }
.animate-lp-toast-in { animation: lp-toast-in .3s ease-out; }
`
      }} />
      {showSplash && (
        <div className="fixed inset-0 z-[9999] bg-[#f8f9fa] flex items-center justify-center flex-col animate-splash-fade-out">
          <div className="absolute z-[2] animate-rocket-fly">
            <img src="assets/sprites/robot/robot_idle.svg" alt="Robot Flow" className="w-[clamp(100px,25vw,140px)] h-auto [filter:drop-shadow(0_10px_30px_rgba(124,92,252,0.5))]" />
          </div>
          <div className="z-10 opacity-0 animate-splash-text-reveal flex flex-col items-center gap-2.5">
            <div className="text-[clamp(1rem,3vw,1.8rem)] font-medium text-black/60 tracking-[0.1em] uppercase mb-[-15px]">Welcome to the</div>
            <img src="assets/splash_logo_b.png" alt="Leaplab Logo" className="h-[clamp(60px,15vw,120px)] w-auto object-contain [filter:drop-shadow(0_10px_30px_rgba(124,92,252,0.4))]" />
            <div className="mt-3.75 flex items-center gap-2.5 opacity-0 animate-splash-text-reveal-delayed">
              <span className="text-[0.85rem] font-semibold text-black/40 uppercase tracking-[0.1em]">Powered by</span>
              <img src="assets/topbar_logo.svg" alt="LeapLab" className="h-[28px] opacity-80" />
            </div>
          </div>
        </div>
      )}

      <div className="font-sans bg-[#f0f4ff] text-[#0F172A] h-screen flex flex-col relative overflow-hidden">
        {/* Image 1 – PREMIUM – dark gradients with light green/pink/blue – VISIBLE */}
        <div className="absolute inset-0 -z-10 pointer-events-none overflow-hidden">
          {/* Base premium tint – not white */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#e8f0ff] via-[#f2f5ff] to-[#fdf2f8]" />
          <div className="absolute inset-0 opacity-[0.85]" style={{ background: `radial-gradient(ellipse 900px 600px at 0% 0%, rgba(167,243,208,0.38) 0%, transparent 60%), radial-gradient(ellipse 900px 520px at 50% 0%, rgba(191,219,254,0.45) 0%, transparent 65%), radial-gradient(ellipse 750px 420px at 92% 6%, rgba(221,214,254,0.38) 0%, transparent 62%)` }} />
          {/* Exact uploaded image – enhanced */}
          <img src="/assets/landing-bg.png" alt="" className="absolute inset-0 w-full h-full object-cover object-top" style={{ objectPosition: 'center top', filter: 'saturate(1.25) contrast(1.08)', opacity: 0.88 }} onError={(e) => { const t=e.currentTarget as HTMLImageElement; if(t.src.includes('.png')) t.src='/assets/landing-bg.svg'; else t.style.display='none'; }} />
          {/* Dark premium blobs – clearly visible */}
          <div className="absolute top-[5%] right-[7%] w-[620px] h-[460px] bg-gradient-to-br from-[#1e3a8a] via-[#2563eb] to-[#60a5fa] rounded-[42%_58%_68%_32%/42%_42%_58%_58%] opacity-[0.82] border border-white/20 shadow-[0_16px_48px_rgba(30,58,138,0.30)]" style={{ maxWidth: '52vw' }}>
            <div className="absolute inset-[14%] bg-gradient-to-br from-[#dbeafe]/85 to-white/60 rounded-[inherit] blur-[14px]" />
          </div>
          <div className="absolute top-[4%] right-[10%] w-[520px] h-[380px] bg-gradient-to-br from-[#4c1d95] via-[#7c3aed] to-[#a78bfa] rounded-[58%_42%_32%_68%/58%_32%_68%_42%] opacity-[0.78] border border-white/15 shadow-[0_12px_36px_rgba(124,58,237,0.28)]" style={{ maxWidth: '44vw' }}>
            <div className="absolute inset-[16%] bg-gradient-to-br from-[#ede9fe]/80 to-white/55 rounded-[inherit] blur-[12px]" />
          </div>
          <div className="absolute top-[11%] right-[25%] w-[150px] h-[88px] bg-gradient-to-br from-[#831843] via-[#be185d] to-[#f9a8d4] rounded-full opacity-[0.88] rotate-12 shadow-[0_10px_28px_rgba(190,24,93,0.32)] border border-white/20">
            <div className="absolute inset-[18%] bg-gradient-to-br from-[#fce7f3]/75 to-white/55 rounded-full blur-[6px]" />
          </div>
          <div className="absolute top-[8%] right-[36%] w-[112px] h-[66px] bg-gradient-to-br from-[#064e3b] via-[#059669] to-[#6ee7b7] rounded-full opacity-[0.84] -rotate-12 border border-white/15 shadow-[0_8px_20px_rgba(5,150,105,0.28)]">
            <div className="absolute inset-[20%] bg-gradient-to-br from-[#d1fae5]/70 to-white/45 rounded-full blur-[5px]" />
          </div>
          <div className="absolute bottom-[15%] right-[4.5%] w-[86px] h-[128px] bg-gradient-to-br from-[#1e40af] via-[#3b82f6] to-[#93c5fd] rounded-full opacity-[0.82] rotate-12 border border-white/20 shadow-[0_10px_24px_rgba(30,64,175,0.28)]" />
          <div className="absolute bottom-[11%] right-[0.9%] w-[54px] h-[54px] bg-gradient-to-br from-[#be185d] to-[#f472b6] rounded-full opacity-[0.78] border border-white/20" />
          {/* Bottom dark waves – premium */}
          <svg className="absolute bottom-0 left-0 w-full h-[185px]" viewBox="0 0 1440 185" preserveAspectRatio="none" fill="none" aria-hidden>
            <defs>
              <linearGradient id="waveDarkBlue" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#1e3a8a" stopOpacity="0.92"/>
                <stop offset="50%" stopColor="#2563eb" stopOpacity="0.88"/>
                <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.88"/>
              </linearGradient>
              <linearGradient id="waveDarkGreen" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#064e3b" stopOpacity="0.88"/>
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.82"/>
              </linearGradient>
              <linearGradient id="waveDarkPink" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#831843" stopOpacity="0.86"/>
                <stop offset="100%" stopColor="#f9a8d4" stopOpacity="0.8"/>
              </linearGradient>
            </defs>
            <path d="M -40 80 C 140 44 300 84 520 68 C 740 46 940 88 1160 60 C 1300 42 1380 66 1480 52 L 1480 185 L -40 185 Z" fill="url(#waveDarkBlue)"/>
            <path d="M -40 108 C 160 72 300 114 520 92 C 740 70 940 118 1160 88 C 1300 70 1380 92 1480 80 L 1480 185 L -40 185 Z" fill="url(#waveDarkGreen)" opacity="0.92"/>
            <path d="M -20 138 C 180 110 360 144 640 122 C 880 98 1100 144 1420 112 L 1420 185 L -20 185 Z" fill="url(#waveDarkPink)" opacity="0.88"/>
          </svg>
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: `radial-gradient(rgba(99,102,241,1) 1.4px, transparent 1.4px)`, backgroundSize: '30px 30px' }} />
        </div>

        {/* TOPBAR */}
        <nav className="shrink-0 h-[72px] py-2 flex items-center justify-between px-6 bg-[#F8FAFC]/85 backdrop-blur-[16px] shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] border-b border-[rgba(0,0,0,0.06)] sm:px-4 sm:h-[68px] relative z-[200]">
          <div className="flex items-center gap-[32px] sm:gap-[16px]">
            <a href="#" className="flex items-center gap-[10px] no-underline filter drop-shadow-[0_2px_8px_rgba(99,102,241,0.15)]" onClick={() => {
              setActiveTab('modules');
              sessionStorage.setItem('landingActiveTab', 'modules');
              sessionStorage.removeItem('myProjectsSelectedMode');
              setMenuOpen(false);
            }}>
              <img src="assets/Final_logo_b.png" alt="LeapLab Logo" className="h-[50px] w-auto object-contain" />
            </a>
            <div className="hidden md:flex gap-6 ml-3 items-center">
              <button className="bg-transparent border-none text-[#0f172a] no-underline font-semibold text-[0.95rem] cursor-pointer py-1.5 px-3 rounded-full transition-all duration-200 ease-out hover:text-[#4f46e5] hover:bg-[#4f46e5]/[0.06]" onClick={() => (window as any).showComingSoon('Tutorials')}>
                Tutorials
              </button>
              <button className="bg-transparent border-none text-[#0f172a] no-underline font-semibold text-[0.95rem] cursor-pointer py-1.5 px-3 rounded-full transition-all duration-200 ease-out hover:text-[#4f46e5] hover:bg-[#4f46e5]/[0.06]" onClick={() => (window as any).showComingSoon('Explore')}>
                Explore
              </button>
              <button
                className={`font-semibold text-[0.95rem] cursor-pointer py-1.5 px-4 rounded-full transition-all duration-200 ease-out focus:outline-none ${
                  showProjects
                    ? 'bg-[#7c3aed] text-white shadow-sm hover:bg-[#6d28d9] hover:text-white'
                    : 'bg-transparent text-[#0f172a] hover:text-[#7c3aed] hover:bg-[#7c3aed]/[0.08]'
                }`}
                onClick={() => {
                  const target = showProjects ? 'modules' : 'my-projects';
                  setActiveTab(target);
                  sessionStorage.setItem('landingActiveTab', target);
                }}
              >
                My Projects
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 md:gap-6 filter drop-shadow-[0_2px_6px_rgba(0,0,0,0.08)]">
            <LeapLabAuthButton variant="light" size="md" />
            <div className="hidden md:block w-[1.5px] h-6 bg-[rgba(15,23,42,0.15)]"></div>
            <img src="assets/topbar_logo.svg" alt="Leapblocks Top Logo" className="h-[35px]" />

            {/* Hamburger button for Mobile */}
            <button
              className="md:hidden flex items-center justify-center p-2 rounded-xl text-[#0F172A] hover:bg-slate-100 focus:outline-none transition-colors"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Toggle navigation menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {menuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </nav>

        {/* Mobile Dropdown Menu */}
        {menuOpen && (
          <div className="absolute top-[72px] sm:top-[68px] left-0 w-full bg-[#F8FAFC]/95 backdrop-blur-[16px] border-b border-[rgba(0,0,0,0.06)] z-[190] flex flex-col p-4 gap-2.5 shadow-lg md:hidden animate-slide-down">
            <button
              className="w-full text-left py-3 px-4 font-semibold text-slate-800 rounded-xl hover:bg-[#4f46e5]/[0.06] hover:text-[#4f46e5] transition-colors"
              onClick={() => {
                (window as any).showComingSoon('Tutorials');
                setMenuOpen(false);
              }}
            >
              Tutorials
            </button>
            <button
              className="w-full text-left py-3 px-4 font-semibold text-slate-800 rounded-xl hover:bg-[#4f46e5]/[0.06] hover:text-[#4f46e5] transition-colors"
              onClick={() => {
                (window as any).showComingSoon('Explore');
                setMenuOpen(false);
              }}
            >
              Explore
            </button>
            <button
              className={`w-full text-left py-3 px-4 font-semibold rounded-xl transition-colors focus:outline-none ${
                showProjects
                  ? 'bg-[#7c3aed] text-white shadow-sm'
                  : 'text-slate-800 hover:bg-[#7c3aed]/[0.08] hover:text-[#7c3aed]'
              }`}
              onClick={() => {
                const target = showProjects ? 'modules' : 'my-projects';
                setActiveTab(target);
                sessionStorage.setItem('landingActiveTab', target);
                setMenuOpen(false);
              }}
            >
              My Projects
            </button>
          </div>
        )}

        {/* Gradient Divider Line */}
        <div className="w-full relative z-[150]">
          <div className="h-[3px] w-full bg-[linear-gradient(90deg,#F97316_0%,#14B8A6_20%,#3B82F6_40%,#A855F7_60%,#22C55E_80%,#EC4899_100%)]"></div>
          <div className="h-[2px] w-full bg-[linear-gradient(90deg,rgba(249,115,22,0.5),rgba(20,184,166,0.5),rgba(59,130,246,0.5),rgba(168,85,247,0.5),rgba(34,197,94,0.5),rgba(236,72,153,0.5))] opacity-60"></div>
        </div>

        <div className="relative z-10 flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin scroll-smooth">

          {activeTab === 'my-projects' && (
            <MyProjectsDashboard onOpenProject={(mode) => onSelect(mode)} />
          )}

          {activeTab === 'modules' && (
            <>
              {/* HERO */}
              <div className="grid grid-cols-[1.1fr_0.9fr] items-center w-full max-w-[1600px] mx-auto py-3 px-10 gap-8 flex-1 max-h-[720px] min-h-[clamp(200px,32vh,440px)] max-[1280px]:py-2 max-[1280px]:gap-6 max-[1024px]:grid-cols-1 max-[1024px]:text-center max-[1024px]:gap-4 max-[1024px]:p-5 max-[1024px]:min-h-0 max-[1024px]:flex-none max-[1024px]:max-h-none max-[768px]:py-3 max-[768px]:px-4 max-[768px]:gap-4 max-[640px]:py-3 max-[640px]:px-4 max-[640px]:gap-3 max-[480px]:py-3 max-[480px]:px-3 max-[480px]:gap-3">
                <div className="max-[1024px]:flex max-[1024px]:flex-col max-[1024px]:items-center">
                  <div className="inline-block text-[10px] font-extrabold text-black uppercase tracking-[0.25em] mb-2 px-3 py-1 bg-[#BEF264] border-2 border-black shadow-[2px_2px_0px_#000] -rotate-1 max-[480px]:text-[10px] max-[480px]:px-2.5 max-[480px]:py-1 max-[480px]:mb-2 animate-hero-reveal">Curiosity - Creativity - Critical Thinking</div>
                  <h1 className="headline text-[clamp(2.2rem,3.8vw,3.9rem)] font-black leading-[1.12] tracking-[-0.04em] mb-3 text-[#0a0a18] font-['Poppins','Inter',sans-serif] max-[768px]:text-[2rem] max-[768px]:leading-[1.1] max-[768px]:mb-2 max-[640px]:text-[2.6rem] max-[480px]:text-[2.2rem] animate-hero-reveal [animation-delay:0.1s] overflow-visible pr-2 pb-1">
                    <span className="font-black tracking-[-0.04em]">Learn to</span> <span className="bg-gradient-to-r from-[#3B5BFF] to-[#7A3FF2] bg-clip-text text-transparent font-black tracking-[-0.02em]">code</span><span className="bg-gradient-to-r from-[#7A3FF2] to-[#E63FA0] bg-clip-text text-transparent font-black tracking-[-0.04em] ml-[0.06em]">»»</span>
                    <br />
                    <span className="font-black tracking-[-0.04em]">the</span> <span className="font-black italic bg-gradient-to-r from-[#7A18FF] to-[#E63FA0] bg-clip-text text-transparent tracking-[-0.02em] pl-1 pr-4 mr-1 inline-block overflow-visible" style={{ paddingRight: '0.22em', marginRight: '0.08em' }}>bold</span> <span className="font-black tracking-[-0.04em]">way</span>
                  </h1>
                  <p className="text-[clamp(0.9rem,1.5vw,1.1rem)] text-slate-600 font-normal leading-[1.6] max-w-[600px] mb-3 relative z-10 max-[1024px]:mx-auto max-[1024px]:max-w-[90%] max-[768px]:mb-2 max-[768px]:text-[0.9rem] max-[640px]:text-md max-[640px]:max-w-full max-[640px]:p-0 max-[480px]:text-[0.9rem] max-[480px]:leading-[1.4] max-[480px]:mb-3 animate-hero-reveal [animation-delay:0.2s]">
                    Eight unique tracks from junior picture-blocks all the way to AI,
                    robotics, and machine vision. Pick your adventure.
                  </p>
                  <div className="flex gap-4 flex-wrap max-[1024px]:justify-center max-[1024px]:w-full max-[1024px]:gap-3 max-[768px]:gap-2 max-[640px]:gap-3 max-[640px]:flex-col animate-hero-reveal [animation-delay:0.3s]">
                    <button
                      className="bg-gradient-to-r from-[#4F46E5] via-[#6366F1] to-[#7A3FF2] border-none text-white text-[0.95rem] font-bold cursor-pointer font-inherit py-3.5 px-7 rounded-full transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] shadow-[0_8px_20px_rgba(79,70,229,0.28),0_4px_12px_rgba(99,102,241,0.18)] hover:from-[#4338CA] hover:via-[#4F46E5] hover:to-[#6366F1] hover:scale-[1.02] hover:shadow-[0_12px_28px_rgba(79,70,229,0.35)] active:scale-[0.98] max-[768px]:py-3 max-[768px]:px-6 max-[768px]:text-[0.9rem] max-[640px]:w-full max-[640px]:py-3.5 max-[640px]:px-6 max-[640px]:text-md max-[480px]:py-3.5 max-[480px]:px-5 max-[480px]:text-[0.9rem]"
                      onClick={() => {
                        if (highlightCards) {
                          stopCardScan();
                        } else {
                          startCardScan();
                          document.querySelector('.cards-wrap')?.scrollIntoView({ behavior: 'smooth' });
                        }
                      }}
                    >
                      Choose your adventure
                    </button>
                    <button className="bg-white border border-[#E0E7FF] text-[#1e1b4b] text-[0.95rem] font-bold cursor-pointer font-inherit py-3.5 px-7 pr-8 rounded-full inline-flex items-center gap-3 transition-all duration-200 shadow-[0_4px_12px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)] hover:bg-[#f8faff] hover:border-[#C7D2FE] hover:shadow-[0_8px_20px_rgba(99,102,241,0.10)] hover:scale-[1.02] active:scale-[0.98] max-[640px]:w-full max-[640px]:justify-center max-[640px]:py-3.5 max-[640px]:px-6 max-[480px]:py-3.5 max-[480px]:px-5" onClick={() => (window as any).showComingSoon('Demo Video')}>
                      <span className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3B5BFF] via-[#4F46E5] to-[#7A3FF2] flex items-center justify-center text-white shadow-[0_2px_8px_rgba(79,70,229,0.30)] shrink-0">
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="white" className="ml-[1.5px]"><path d="M3.5 2.2 L11.5 7 L3.5 11.8 Z" /></svg>
                      </span>
                      Watch 2-min demo
                    </button>
                  </div>
                </div>

                {/* RIGHT: Cinematic 3D video card cascade (Meta AI / keynote style) */}
                <div className="flex items-center justify-center relative w-full animate-hero-reveal [animation-delay:0.4s]">
                  <Suspense fallback={
                    <div className="w-full flex items-center justify-center min-h-[340px]">
                      <div className="w-10 h-10 border-3 border-[rgba(99,102,241,0.15)] border-t-[#6366F1] rounded-full animate-hero3d-spin" />
                    </div>
                  }>
                    <HeroCardDeckAnimation onSelect={onSelect} />
                  </Suspense>
                </div>
              </div>

              {/* 8 TRACK CARDS — premium light pastel, responsive */}
              <div className="cards-wrap w-full mx-auto py-3 px-6 pb-2 shrink-0 flex items-center justify-center max-[768px]:py-2 max-[768px]:px-4 max-[768px]:pb-1">
                <div className={`grid w-full max-w-[1600px] grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8 min-h-0 ${highlightCards ? 'highlight-active' : ''} ${scanIndex >= 0 ? 'is-scanning' : ''}`}>

                  {/* 1 IGNITE — orange/amber */}
                  <div className={getCardClasses(0, 'bg-gradient-to-br from-orange-100 via-amber-50 to-orange-100')} onClick={() => handleCardClick(() => onSelect('junior'))}>
                    <div className="flex flex-1 flex-col">
                      <div className="mb-4 flex h-24 items-center justify-center max-[768px]:mb-3 max-[768px]:h-16">
                        <img src="assets/ignite_icon.png" alt="Ignite" className="h-20 w-20 object-contain drop-shadow-sm transition-transform duration-300 group-hover:scale-110 max-[768px]:h-14 max-[768px]:w-14" />
                      </div>
                      <h3 className="text-[20px] font-extrabold tracking-tight text-orange-700 uppercase">IGNITE</h3>
                      <p className="mt-1 max-w-[170px] text-[14px] font-medium leading-5 text-slate-600">Learn coding<br/>with fun visual blocks</p>
                    </div>
                    <div className="absolute bottom-0 left-0 h-1 w-0 bg-orange-500 transition-all duration-300 group-hover:w-full"></div>
                  </div>

                  {/* 2 EMBED — cyan/blue */}
                  <div className={getCardClasses(1, 'bg-gradient-to-br from-cyan-100 via-sky-50 to-blue-100')} onClick={() => handleCardClick(() => onSelect('intermediate'))}>
                    <div className="flex flex-1 flex-col">
                      <div className="mb-4 flex h-24 items-center justify-center max-[768px]:mb-3 max-[768px]:h-16">
                        <img src="assets/arduino_icon.png" alt="Embed" className="h-20 w-20 object-contain drop-shadow-sm transition-transform duration-300 group-hover:scale-110 max-[768px]:h-14 max-[768px]:w-14" />
                      </div>
                      <h3 className="text-[20px] font-extrabold tracking-tight text-cyan-600 uppercase">EMBED</h3>
                      <p className="mt-1 max-w-[170px] text-[14px] font-medium leading-5 text-slate-600">Build with<br/>Arduino, sensors & IoT</p>
                    </div>
                    <div className="absolute bottom-0 left-0 h-1 w-0 bg-cyan-500 transition-all duration-300 group-hover:w-full"></div>
                  </div>

                  {/* 3 LOGIX — blue/indigo */}
                  <div className={getCardClasses(2, 'bg-gradient-to-br from-blue-100 via-indigo-50 to-blue-100')} onClick={() => handleCardClick(() => onSelect('python'))}>
                    <div className="flex flex-1 flex-col">
                      <div className="mb-4 flex h-24 items-center justify-center max-[768px]:mb-3 max-[768px]:h-16">
                        <img src="assets/python_icon.png" alt="Logix" className="h-20 w-20 object-contain drop-shadow-sm transition-transform duration-300 group-hover:scale-110 max-[768px]:h-14 max-[768px]:w-14" />
                      </div>
                      <h3 className="text-[20px] font-extrabold tracking-tight text-blue-600 uppercase">LOGIX</h3>
                      <p className="mt-1 max-w-[170px] text-[14px] font-medium leading-5 text-slate-600">Learn Python &<br/>programming logic</p>
                    </div>
                    <div className="absolute bottom-0 left-0 h-1 w-0 bg-blue-500 transition-all duration-300 group-hover:w-full"></div>
                  </div>

                  {/* 4 NEURA — violet/purple */}
                  <div className={getCardClasses(3, 'bg-gradient-to-br from-violet-100 via-purple-50 to-violet-100')} onClick={() => handleCardClick(() => onSelect('neura'))}>
                    <div className="flex flex-1 flex-col">
                      <div className="mb-4 flex h-24 items-center justify-center max-[768px]:mb-3 max-[768px]:h-16">
                        <img src="assets/ml_brain_icon.png" alt="Neura" className="h-20 w-20 object-contain drop-shadow-sm transition-transform duration-300 group-hover:scale-110 max-[768px]:h-14 max-[768px]:w-14" />
                      </div>
                      <h3 className="text-[20px] font-extrabold tracking-tight text-violet-600 uppercase">NEURA</h3>
                      <p className="mt-1 max-w-[170px] text-[14px] font-medium leading-5 text-slate-600">Explore AI, logic<br/>& intelligent systems</p>
                    </div>
                    <div className="absolute bottom-0 left-0 h-1 w-0 bg-violet-500 transition-all duration-300 group-hover:w-full"></div>
                  </div>

                  {/* 5 ELECTRA — green/emerald */}
                  <div className={getCardClasses(4, 'bg-gradient-to-br from-green-100 via-emerald-50 to-green-100')} onClick={() => handleCardClick(() => onSelect('electra'))}>
                    <div className="flex flex-1 flex-col">
                      <div className="mb-4 flex h-24 items-center justify-center max-[768px]:mb-3 max-[768px]:h-16">
                        <img src="assets/creocad_icon.png" alt="Electra" className="h-20 w-20 object-contain drop-shadow-sm transition-transform duration-300 group-hover:scale-110 max-[768px]:h-14 max-[768px]:w-14" />
                      </div>
                      <h3 className="text-[20px] font-extrabold tracking-tight text-green-600 uppercase">ELECTRA</h3>
                      <p className="mt-1 max-w-[170px] text-[14px] font-medium leading-5 text-slate-600">Design circuits &<br/>simulate electronics</p>
                    </div>
                    <div className="absolute bottom-0 left-0 h-1 w-0 bg-green-500 transition-all duration-300 group-hover:w-full"></div>
                  </div>

                  {/* 6 VISION3D — sky/cyan */}
                  <div className={getCardClasses(5, 'bg-gradient-to-br from-sky-100 via-cyan-50 to-sky-100')} onClick={() => handleCardClick(() => onSelect('vision3d'))}>
                    <div className="flex flex-1 flex-col">
                      <div className="mb-4 flex h-24 items-center justify-center max-[768px]:mb-3 max-[768px]:h-16">
                        <img src="assets/vision3d_icon.png" alt="Vision3D" className="h-20 w-20 object-contain drop-shadow-sm transition-transform duration-300 group-hover:scale-110 max-[768px]:h-14 max-[768px]:w-14" />
                      </div>
                      <h3 className="text-[20px] font-extrabold tracking-tight text-sky-600 uppercase">VISION3D</h3>
                      <p className="mt-1 max-w-[170px] text-[14px] font-medium leading-5 text-slate-600">Create 3D models<br/>& digital designs</p>
                    </div>
                    <div className="absolute bottom-0 left-0 h-1 w-0 bg-sky-500 transition-all duration-300 group-hover:w-full"></div>
                  </div>

                  {/* 7 CREOVA — pink/rose */}
                  <div className={getCardClasses(6, 'bg-gradient-to-br from-pink-100 via-rose-50 to-pink-100')} onClick={() => handleCardClick(() => onSelect('creova'))}>
                    <div className="flex flex-1 flex-col">
                      <div className="mb-4 flex h-24 items-center justify-center max-[768px]:mb-3 max-[768px]:h-16">
                        <img src="assets/app_game_dev_icon.png" alt="Creova" className="h-20 w-20 object-contain drop-shadow-sm transition-transform duration-300 group-hover:scale-110 max-[768px]:h-14 max-[768px]:w-14" />
                      </div>
                      <h3 className="text-[20px] font-extrabold tracking-tight text-pink-600 uppercase">CREOVA</h3>
                      <p className="mt-1 max-w-[170px] text-[14px] font-medium leading-5 text-slate-600">Build apps, games<br/>& interactive projects</p>
                    </div>
                    <div className="absolute bottom-0 left-0 h-1 w-0 bg-pink-500 transition-all duration-300 group-hover:w-full"></div>
                  </div>

                  {/* 8 PULSE — emerald/green */}
                  <div className={getCardClasses(7, 'bg-gradient-to-br from-emerald-100 via-green-50 to-emerald-100')} onClick={() => handleCardClick(() => onSelect('pulse'))}>
                    <div className="flex flex-1 flex-col">
                      <div className="mb-4 flex h-24 items-center justify-center max-[768px]:mb-3 max-[768px]:h-16">
                        <img src="assets/quiz_icon.png" alt="Pulse" className="h-20 w-20 object-contain drop-shadow-sm transition-transform duration-300 group-hover:scale-110 max-[768px]:h-14 max-[768px]:w-14" />
                      </div>
                      <h3 className="text-[20px] font-extrabold tracking-tight text-emerald-600 uppercase">PULSE</h3>
                      <p className="mt-1 max-w-[170px] text-[14px] font-medium leading-5 text-slate-600">Create quizzes &<br/>assess learning</p>
                    </div>
                    <div className="absolute bottom-0 left-0 h-1 w-0 bg-emerald-500 transition-all duration-300 group-hover:w-full"></div>
                  </div>

                </div>
              </div>
            </>
          )}

          {/* FOOTER */}
          {activeTab === 'modules' && (
            <footer className="relative w-full text-center py-5 px-6 flex items-center justify-center gap-2 shrink-0 z-10 mt-auto border-t border-[rgba(0,0,0,0.05)] bg-[rgba(248,250,252,0.5)] backdrop-blur-[8px] max-[768px]:py-3 max-[768px]:px-4">
              {/* Ambient glow dot */}
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[radial-gradient(circle,#6366f1,#a855f7)] shadow-[0_0_8px_2px_rgba(99,102,241,0.5)] shrink-0" />
              <span className="text-[clamp(0.7rem,1.2vw,0.85rem)] font-['Poppins',sans-serif] font-medium tracking-[0.04em] bg-[linear-gradient(90deg,#0a015a_0%,#6366f1_50%,#a855f7_100%)] [-webkit-background-clip:text] [-webkit-text-fill-color:transparent] bg-clip-text">
                LeapLab v1.0 &copy; 2026 Creoleap Technologies Pvt. Ltd. — All rights reserved.
              </span>
              {/* Ambient glow dot */}
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[radial-gradient(circle,#a855f7,#6366f1)] shadow-[0_0_8px_2px_rgba(168,85,247,0.5)] shrink-0" />
            </footer>
          )}

        </div>

        {/* Toast notification */}
        {toast.visible && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 py-3.5 px-5 rounded-[18px] bg-[rgba(15,23,42,0.94)] text-white text-[13px] font-bold font-['Poppins',sans-serif] shadow-[0_18px_34px_rgba(15,23,42,0.22)] animate-lp-toast-in z-[1000] flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[linear-gradient(135deg,#f59e0b,#38bdf8)] shadow-[0_0_14px_rgba(56,189,248,0.45)]" />
            {toast.message}
          </div>
        )}
      </div>
    </>
  );
};

export default LandingPage;
