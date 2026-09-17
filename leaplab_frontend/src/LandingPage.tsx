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
        stateClasses = 'shadow-[0_2px_10px_rgba(15,23,42,0.06),0_8px_24px_rgba(15,23,42,0.04)]';
      }
    }

    return `group relative flex flex-1 flex-col rounded-[20px] border-2 p-4 cursor-pointer overflow-hidden transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_12px_32px_rgba(15,23,42,0.12),0_4px_12px_rgba(15,23,42,0.08)] max-[1440px]:p-3.5 max-[1440px]:rounded-[18px] max-[1366px]:p-3 max-[1366px]:rounded-[16px] max-[768px]:p-3 max-[768px]:rounded-[14px] ${themeClasses} ${stateClasses}`;
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
.landing-scroll { scrollbar-width: thin; scrollbar-color: rgba(99,102,241,0.28) transparent; scrollbar-gutter: stable; }
.landing-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.landing-scroll::-webkit-scrollbar-track { background: transparent; }
.landing-scroll::-webkit-scrollbar-thumb { background: linear-gradient(to bottom, rgba(99,102,241,0.22), rgba(168,85,247,0.22)); border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; }
.landing-scroll::-webkit-scrollbar-thumb:hover { background: linear-gradient(to bottom, rgba(99,102,241,0.36), rgba(168,85,247,0.36)); background-clip: padding-box; }
@media (max-height: 820px) { .hero-14fix { padding-top: 12px !important; padding-bottom: 12px !important; } .hero-14fix h1 { margin-bottom: 8px !important; font-size: clamp(1.9rem, 2.9vw, 3.1rem) !important; line-height: 1.1 !important; } .hero-14fix p { margin-bottom: 10px !important; } .hero-deck-14 { transform: scale(0.88); transform-origin: center; } }
@media (max-height: 760px) { .hero-14fix { gap: 16px !important; } .hero-deck-14 { transform: scale(0.82); } }
@media (max-width: 1366px) and (max-height: 820px) { .hero-14fix { gap: 14px !important; } }
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

      <div className="font-sans bg-[#f8fbff] text-[#0F172A] h-screen flex flex-col relative overflow-hidden">
        {/* Background – soft pastel bloom like Image 1 (light mint/blue/pink) */}
        <div className="absolute inset-0 -z-10 pointer-events-none overflow-hidden bg-[#f8fbff]">
          <div className="absolute inset-0 bg-gradient-to-br from-[#ffffff] via-[#f8fbff] to-[#eef4ff]" />
          {/* Mint left */}
          <div className="absolute -top-[18%] -left-[10%] w-[620px] h-[520px] opacity-70" style={{ background: `radial-gradient(ellipse 520px 380px at 30% 30%, rgba(167,243,208,0.55) 0%, rgba(167,243,208,0.18) 42%, transparent 72%)`, filter: 'blur(6px)' }} />
          <div className="absolute top-0 left-[14%] w-[760px] h-[340px] opacity-60" style={{ background: `radial-gradient(ellipse 760px 320px at 30% 20%, rgba(219,234,254,0.75) 0%, rgba(224,231,255,0.35) 48%, transparent 75%)`, filter: 'blur(8px)' }} />
          <div className="absolute -top-[10%] right-[6%] w-[540px] h-[380px] opacity-50" style={{ background: `radial-gradient(ellipse 540px 340px at 50% 30%, rgba(199,210,254,0.45) 0%, rgba(224,231,255,0.25) 55%, transparent 75%)` }} />
          <svg className="absolute top-0 right-0 w-[74%] h-[78%] max-w-[980px] -mr-[2%]" viewBox="0 0 860 520" preserveAspectRatio="xMidYMid meet" fill="none" aria-hidden>
            <defs>
              <linearGradient id="img1-blobOuter" x1="14%" y1="12%" x2="88%" y2="88%">
                <stop offset="0%" stopColor="#dbeafe" stopOpacity="0.95"/>
                <stop offset="45%" stopColor="#e0e7ff" stopOpacity="0.78"/>
                <stop offset="100%" stopColor="#bfdbfe" stopOpacity="0.55"/>
              </linearGradient>
              <linearGradient id="img1-blobInner" x1="20%" y1="15%" x2="80%" y2="85%">
                <stop offset="0%" stopColor="#f9a8d4" stopOpacity="0.58"/>
                <stop offset="32%" stopColor="#e9d5ff" stopOpacity="0.42"/>
                <stop offset="68%" stopColor="#dbeafe" stopOpacity="0.55"/>
                <stop offset="100%" stopColor="#bfdbfe" stopOpacity="0.38"/>
              </linearGradient>
              <linearGradient id="img1-blobSmallPink" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#f0abfc" stopOpacity="0.85"/>
                <stop offset="50%" stopColor="#c4b5fd" stopOpacity="0.55"/>
                <stop offset="100%" stopColor="#bfdbfe" stopOpacity="0.35"/>
              </linearGradient>
            </defs>
            <path d="M 520 18 C 660 32 760 96 800 190 C 838 282 812 372 740 430 C 668 488 562 498 470 452 C 378 406 300 322 282 228 C 268 148 310 72 386 38 C 430 18 476 10 520 18 Z" fill="none" stroke="#bfdbfe" strokeOpacity="0.32" strokeWidth="42" />
            <path d="M 520 18 C 660 32 760 96 800 190 C 838 282 812 372 740 430 C 668 488 562 498 470 452 C 378 406 300 322 282 228 C 268 148 310 72 386 38 C 430 18 476 10 520 18 Z" fill="url(#img1-blobOuter)" opacity="0.92" />
            <path d="M 500 36 C 610 42 710 88 758 168 C 790 232 782 296 736 348 C 678 412 588 432 510 400 C 432 368 364 300 342 224 C 324 164 350 102 402 66 C 434 44 466 34 500 36 Z" fill="white" opacity="0.72" style={{ filter: 'blur(18px)' }} />
            <path d="M 512 58 C 620 66 718 118 750 206 C 778 284 748 356 686 404 C 618 456 528 466 448 426 C 372 388 314 314 306 232 C 300 170 330 108 384 76 C 424 52 468 54 512 58 Z" fill="url(#img1-blobInner)" />
            <ellipse cx="356" cy="96" rx="58" ry="34" fill="url(#img1-blobSmallPink)" transform="rotate(-28 356 96)" opacity="0.95" />
            <ellipse cx="356" cy="96" rx="58" ry="34" fill="white" opacity="0.32" transform="rotate(-28 356 96)" style={{ filter: 'blur(10px)' }} />
            <ellipse cx="288" cy="258" rx="92" ry="86" fill="#dbeafe" opacity="0.55" style={{ filter: 'blur(4px)' }} />
            <circle cx="824" cy="34" r="52" fill="#bfdbfe" opacity="0.42" />
            <ellipse cx="782" cy="424" rx="36" ry="52" fill="#bfdbfe" opacity="0.52" transform="rotate(-14 782 424)" />
            <ellipse cx="838" cy="418" rx="18" ry="26" fill="#bfdbfe" opacity="0.42" transform="rotate(-12 838 418)" />
            <ellipse cx="802" cy="518" rx="16" ry="24" fill="#c7d2fe" opacity="0.38" />
          </svg>
          <svg className="absolute bottom-0 left-0 w-full h-[168px]" viewBox="0 0 1440 168" preserveAspectRatio="none" fill="none" aria-hidden>
            <defs>
              <linearGradient id="img1-wave1" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#bfdbfe" stopOpacity="0.58"/>
                <stop offset="50%" stopColor="#c7d2fe" stopOpacity="0.48"/>
                <stop offset="100%" stopColor="#ddd6fe" stopOpacity="0.42"/>
              </linearGradient>
              <linearGradient id="img1-wave2" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#dbeafe" stopOpacity="0.52"/>
                <stop offset="100%" stopColor="#bfdbfe" stopOpacity="0.48"/>
              </linearGradient>
            </defs>
            <path d="M -40 78 C 120 44 260 62 380 72 C 560 88 700 44 880 62 C 1040 78 1180 52 1480 72 L 1480 168 L -40 168 Z" fill="url(#img1-wave1)" opacity="0.95"/>
            <path d="M -40 108 C 80 72 220 96 340 102 C 520 114 660 78 860 98 C 1020 112 1200 84 1480 108 L 1480 168 L -40 168 Z" fill="url(#img1-wave2)" />
            <path d="M -40 136 C 160 112 320 138 520 124 C 720 110 980 142 1220 118 L 1480 138 L 1480 168 L -40 168 Z" fill="#e0e7ff" opacity="0.55"/>
          </svg>
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

        <div className="relative z-10 flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-hidden landing-scroll scroll-smooth">

          {activeTab === 'my-projects' && (
            <MyProjectsDashboard onOpenProject={(mode) => onSelect(mode)} />
          )}

          {activeTab === 'modules' && (
            <>
              {/* HERO — fixed for 14" (1366x768): no flex-1 overlap, natural height + scroll */}
              <div className="hero-14fix grid grid-cols-[1.1fr_0.9fr] items-center w-full max-w-[1600px] mx-auto py-5 px-10 gap-8 shrink-0 max-[1440px]:py-4 max-[1440px]:gap-6 max-[1366px]:py-3 max-[1366px]:px-6 max-[1366px]:gap-5 max-[1280px]:py-3 max-[1280px]:gap-5 max-[1024px]:grid-cols-1 max-[1024px]:text-center max-[1024px]:gap-4 max-[1024px]:p-5 max-[1024px]:py-4 max-[768px]:py-3 max-[768px]:px-4 max-[768px]:gap-4 max-[640px]:py-3 max-[640px]:px-4 max-[640px]:gap-3 max-[480px]:py-3 max-[480px]:px-3 max-[480px]:gap-3">
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

                {/* RIGHT: Cinematic 3D video card cascade — scaled down on 14" to avoid overlap */}
                <div className="hero-deck-14 flex items-center justify-center relative w-full animate-hero-reveal [animation-delay:0.4s] max-[1366px]:scale-[0.92] max-[1366px]:origin-center min-[1367px]:scale-100">
                  <Suspense fallback={
                    <div className="w-full flex items-center justify-center min-h-[340px]">
                      <div className="w-10 h-10 border-3 border-[rgba(99,102,241,0.15)] border-t-[#6366F1] rounded-full animate-hero3d-spin" />
                    </div>
                  }>
                    <HeroCardDeckAnimation onSelect={onSelect} />
                  </Suspense>
                </div>
              </div>

              {/* 8 TRACK CARDS — responsive for all panels, order preserved: 2 cols mobile → 4 tablet → 8 desktop (1366 keeps 8 in one row, scaled) */}
              <div className="cards-wrap w-full mx-auto py-4 px-6 pb-4 shrink-0 flex items-start justify-center max-[1440px]:px-5 max-[1366px]:py-3 max-[1366px]:px-4 max-[1366px]:pb-3 max-[768px]:py-2 max-[768px]:px-4 max-[768px]:pb-1">
                <div className={`grid w-full max-w-[1600px] grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8 max-[1366px]:gap-2 min-h-0 ${highlightCards ? 'highlight-active' : ''} ${scanIndex >= 0 ? 'is-scanning' : ''}`}>

                  {/* 1 IGNITE — softer saturation */}
                  <div className={getCardClasses(0, 'bg-gradient-to-br from-orange-100 via-amber-50 to-orange-200 border-orange-200 shadow-[0_3px_14px_rgba(251,146,60,0.12)] hover:border-orange-300 hover:shadow-[0_8px_22px_rgba(251,146,60,0.18)]')} onClick={() => handleCardClick(() => onSelect('junior'))}>
                    <div className="absolute inset-0 bg-gradient-to-br from-orange-500/[0.03] via-transparent to-amber-500/[0.04] pointer-events-none" />
                    <div className="flex flex-1 flex-col relative">
                      <div className="mb-4 flex h-24 items-center justify-center max-[1366px]:mb-2.5 max-[1366px]:h-[68px] max-[768px]:mb-3 max-[768px]:h-16">
                        <img src="assets/ignite_icon.png" alt="Ignite" className="h-[74px] w-[74px] max-[1366px]:h-[58px] max-[1366px]:w-[58px] object-contain drop-shadow-[0_3px_8px_rgba(251,146,60,0.18)] transition-transform duration-300 group-hover:scale-110" />
                      </div>
                      <h3 className="text-[20px] font-black tracking-tight text-orange-700 uppercase max-[1366px]:text-[15px]">IGNITE</h3>
                      <p className="mt-1 max-w-[170px] text-[13.5px] font-semibold leading-[18px] text-slate-600 max-[1366px]:text-[11.5px] max-[1366px]:leading-[15px]">Learn coding<br/>with fun visual blocks</p>
                    </div>
                    <div className="absolute bottom-0 left-0 h-[3px] w-0 bg-gradient-to-r from-orange-500 via-orange-400 to-amber-400 transition-all duration-300 group-hover:w-full rounded-b-[18px]"></div>
                  </div>

                  {/* 2 EMBED — softer */}
                  <div className={getCardClasses(1, 'bg-gradient-to-br from-cyan-100 via-sky-50 to-blue-100 border-cyan-200 shadow-[0_3px_14px_rgba(6,182,212,0.10)] hover:border-cyan-300 hover:shadow-[0_8px_22px_rgba(6,182,212,0.15)]')} onClick={() => handleCardClick(() => onSelect('intermediate'))}>
                    <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/[0.03] via-transparent to-blue-500/[0.04] pointer-events-none" />
                    <div className="flex flex-1 flex-col relative">
                      <div className="mb-4 flex h-24 items-center justify-center max-[1366px]:mb-2.5 max-[1366px]:h-[68px] max-[768px]:mb-3 max-[768px]:h-16">
                        <img src="assets/arduino_icon.png" alt="Embed" className="h-[74px] w-[74px] max-[1366px]:h-[58px] max-[1366px]:w-[58px] object-contain drop-shadow-[0_3px_8px_rgba(6,182,212,0.16)] transition-transform duration-300 group-hover:scale-110" />
                      </div>
                      <h3 className="text-[20px] font-black tracking-tight text-cyan-700 uppercase max-[1366px]:text-[15px]">EMBED</h3>
                      <p className="mt-1 max-w-[170px] text-[13.5px] font-semibold leading-[18px] text-slate-600 max-[1366px]:text-[11.5px] max-[1366px]:leading-[15px]">Build with<br/>Arduino, sensors & IoT</p>
                    </div>
                    <div className="absolute bottom-0 left-0 h-[3px] w-0 bg-gradient-to-r from-cyan-500 via-sky-400 to-blue-500 transition-all duration-300 group-hover:w-full rounded-b-[18px]"></div>
                  </div>

                  {/* 3 LOGIX — softer */}
                  <div className={getCardClasses(2, 'bg-gradient-to-br from-blue-100 via-indigo-50 to-blue-200 border-blue-200 shadow-[0_3px_14px_rgba(59,130,246,0.10)] hover:border-blue-300 hover:shadow-[0_8px_22px_rgba(59,130,246,0.15)]')} onClick={() => handleCardClick(() => onSelect('python'))}>
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500/[0.03] via-transparent to-indigo-500/[0.04] pointer-events-none" />
                    <div className="flex flex-1 flex-col relative">
                      <div className="mb-4 flex h-24 items-center justify-center max-[1366px]:mb-2.5 max-[1366px]:h-[68px] max-[768px]:mb-3 max-[768px]:h-16">
                        <img src="assets/python_icon.png" alt="Logix" className="h-[74px] w-[74px] max-[1366px]:h-[58px] max-[1366px]:w-[58px] object-contain drop-shadow-[0_3px_8px_rgba(59,130,246,0.16)] transition-transform duration-300 group-hover:scale-110" />
                      </div>
                      <h3 className="text-[20px] font-black tracking-tight text-blue-700 uppercase max-[1366px]:text-[15px]">LOGIX</h3>
                      <p className="mt-1 max-w-[170px] text-[13.5px] font-semibold leading-[18px] text-slate-600 max-[1366px]:text-[11.5px] max-[1366px]:leading-[15px]">Learn Python &<br/>programming logic</p>
                    </div>
                    <div className="absolute bottom-0 left-0 h-[3px] w-0 bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-500 transition-all duration-300 group-hover:w-full rounded-b-[18px]"></div>
                  </div>

                  {/* 4 NEURA — softer */}
                  <div className={getCardClasses(3, 'bg-gradient-to-br from-violet-100 via-purple-50 to-fuchsia-100 border-violet-200 shadow-[0_3px_14px_rgba(139,92,246,0.10)] hover:border-violet-300 hover:shadow-[0_8px_22px_rgba(139,92,246,0.15)]')} onClick={() => handleCardClick(() => onSelect('neura'))}>
                    <div className="absolute inset-0 bg-gradient-to-br from-violet-500/[0.03] via-transparent to-fuchsia-500/[0.04] pointer-events-none" />
                    <div className="flex flex-1 flex-col relative">
                      <div className="mb-4 flex h-24 items-center justify-center max-[1366px]:mb-2.5 max-[1366px]:h-[68px] max-[768px]:mb-3 max-[768px]:h-16">
                        <img src="assets/ml_brain_icon.png" alt="Neura" className="h-[74px] w-[74px] max-[1366px]:h-[58px] max-[1366px]:w-[58px] object-contain drop-shadow-[0_3px_8px_rgba(139,92,246,0.16)] transition-transform duration-300 group-hover:scale-110" />
                      </div>
                      <h3 className="text-[20px] font-black tracking-tight text-violet-700 uppercase max-[1366px]:text-[15px]">NEURA</h3>
                      <p className="mt-1 max-w-[170px] text-[13.5px] font-semibold leading-[18px] text-slate-600 max-[1366px]:text-[11.5px] max-[1366px]:leading-[15px]">Explore AI, logic<br/>& intelligent systems</p>
                    </div>
                    <div className="absolute bottom-0 left-0 h-[3px] w-0 bg-gradient-to-r from-violet-600 via-purple-500 to-fuchsia-500 transition-all duration-300 group-hover:w-full rounded-b-[18px]"></div>
                  </div>

                  {/* 5 ELECTRA — softer */}
                  <div className={getCardClasses(4, 'bg-gradient-to-br from-green-100 via-emerald-50 to-green-200 border-green-200 shadow-[0_3px_14px_rgba(34,197,94,0.10)] hover:border-green-300 hover:shadow-[0_8px_22px_rgba(34,197,94,0.15)]')} onClick={() => handleCardClick(() => onSelect('electra'))}>
                    <div className="absolute inset-0 bg-gradient-to-br from-green-500/[0.03] via-transparent to-emerald-500/[0.04] pointer-events-none" />
                    <div className="flex flex-1 flex-col relative">
                      <div className="mb-4 flex h-24 items-center justify-center max-[1366px]:mb-2.5 max-[1366px]:h-[68px] max-[768px]:mb-3 max-[768px]:h-16">
                        <img src="assets/creocad_icon.png" alt="Electra" className="h-[74px] w-[74px] max-[1366px]:h-[58px] max-[1366px]:w-[58px] object-contain drop-shadow-[0_3px_8px_rgba(34,197,94,0.16)] transition-transform duration-300 group-hover:scale-110" />
                      </div>
                      <h3 className="text-[20px] font-black tracking-tight text-green-700 uppercase max-[1366px]:text-[15px]">ELECTRA</h3>
                      <p className="mt-1 max-w-[170px] text-[13.5px] font-semibold leading-[18px] text-slate-600 max-[1366px]:text-[11.5px] max-[1366px]:leading-[15px]">Design circuits &<br/>simulate electronics</p>
                    </div>
                    <div className="absolute bottom-0 left-0 h-[3px] w-0 bg-gradient-to-r from-green-600 via-green-500 to-emerald-500 transition-all duration-300 group-hover:w-full rounded-b-[18px]"></div>
                  </div>

                  {/* 6 VISION3D — softer */}
                  <div className={getCardClasses(5, 'bg-gradient-to-br from-sky-100 via-blue-50 to-cyan-100 border-sky-200 shadow-[0_3px_14px_rgba(14,165,233,0.10)] hover:border-sky-300 hover:shadow-[0_8px_22px_rgba(14,165,233,0.15)]')} onClick={() => handleCardClick(() => onSelect('vision3d'))}>
                    <div className="absolute inset-0 bg-gradient-to-br from-sky-500/[0.03] via-transparent to-cyan-500/[0.04] pointer-events-none" />
                    <div className="flex flex-1 flex-col relative">
                      <div className="mb-4 flex h-24 items-center justify-center max-[1366px]:mb-2.5 max-[1366px]:h-[68px] max-[768px]:mb-3 max-[768px]:h-16">
                        <img src="assets/vision3d_icon.png" alt="Vision3D" className="h-[74px] w-[74px] max-[1366px]:h-[58px] max-[1366px]:w-[58px] object-contain drop-shadow-[0_3px_8px_rgba(14,165,233,0.16)] transition-transform duration-300 group-hover:scale-110" />
                      </div>
                      <h3 className="text-[20px] font-black tracking-tight text-sky-700 uppercase max-[1366px]:text-[15px]">VISION3D</h3>
                      <p className="mt-1 max-w-[170px] text-[13.5px] font-semibold leading-[18px] text-slate-600 max-[1366px]:text-[11.5px] max-[1366px]:leading-[15px]">Create 3D models<br/>& digital designs</p>
                    </div>
                    <div className="absolute bottom-0 left-0 h-[3px] w-0 bg-gradient-to-r from-sky-500 via-blue-400 to-cyan-500 transition-all duration-300 group-hover:w-full rounded-b-[18px]"></div>
                  </div>

                  {/* 7 CREOVA — softer */}
                  <div className={getCardClasses(6, 'bg-gradient-to-br from-pink-100 via-rose-50 to-pink-200 border-pink-200 shadow-[0_3px_14px_rgba(236,72,153,0.10)] hover:border-pink-300 hover:shadow-[0_8px_22px_rgba(236,72,153,0.15)]')} onClick={() => handleCardClick(() => onSelect('creova'))}>
                    <div className="absolute inset-0 bg-gradient-to-br from-pink-500/[0.03] via-transparent to-rose-500/[0.04] pointer-events-none" />
                    <div className="flex flex-1 flex-col relative">
                      <div className="mb-4 flex h-24 items-center justify-center max-[1366px]:mb-2.5 max-[1366px]:h-[68px] max-[768px]:mb-3 max-[768px]:h-16">
                        <img src="assets/app_game_dev_icon.png" alt="Creova" className="h-[74px] w-[74px] max-[1366px]:h-[58px] max-[1366px]:w-[58px] object-contain drop-shadow-[0_3px_8px_rgba(236,72,153,0.16)] transition-transform duration-300 group-hover:scale-110" />
                      </div>
                      <h3 className="text-[20px] font-black tracking-tight text-pink-700 uppercase max-[1366px]:text-[15px]">CREOVA</h3>
                      <p className="mt-1 max-w-[170px] text-[13.5px] font-semibold leading-[18px] text-slate-600 max-[1366px]:text-[11.5px] max-[1366px]:leading-[15px]">Build apps, games<br/>& interactive projects</p>
                    </div>
                    <div className="absolute bottom-0 left-0 h-[3px] w-0 bg-gradient-to-r from-pink-500 via-pink-400 to-rose-400 transition-all duration-300 group-hover:w-full rounded-b-[18px]"></div>
                  </div>

                  {/* 8 PULSE — softer */}
                  <div className={getCardClasses(7, 'bg-gradient-to-br from-emerald-100 via-teal-50 to-emerald-200 border-emerald-200 shadow-[0_3px_14px_rgba(16,185,129,0.10)] hover:border-emerald-300 hover:shadow-[0_8px_22px_rgba(16,185,129,0.15)]')} onClick={() => handleCardClick(() => onSelect('pulse'))}>
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/[0.03] via-transparent to-teal-500/[0.04] pointer-events-none" />
                    <div className="flex flex-1 flex-col relative">
                      <div className="mb-4 flex h-24 items-center justify-center max-[1366px]:mb-2.5 max-[1366px]:h-[68px] max-[768px]:mb-3 max-[768px]:h-16">
                        <img src="assets/quiz_icon.png" alt="Pulse" className="h-[74px] w-[74px] max-[1366px]:h-[58px] max-[1366px]:w-[58px] object-contain drop-shadow-[0_3px_8px_rgba(16,185,129,0.16)] transition-transform duration-300 group-hover:scale-110" />
                      </div>
                      <h3 className="text-[20px] font-black tracking-tight text-emerald-700 uppercase max-[1366px]:text-[15px]">PULSE</h3>
                      <p className="mt-1 max-w-[170px] text-[13.5px] font-semibold leading-[18px] text-slate-600 max-[1366px]:text-[11.5px] max-[1366px]:leading-[15px]">Create quizzes &<br/>assess learning</p>
                    </div>
                    <div className="absolute bottom-0 left-0 h-[3px] w-0 bg-gradient-to-r from-emerald-500 via-emerald-400 to-teal-400 transition-all duration-300 group-hover:w-full rounded-b-[18px]"></div>
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
