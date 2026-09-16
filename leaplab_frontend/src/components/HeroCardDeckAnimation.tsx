/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 *
 * HeroCardDeckAnimation.tsx — Cinematic 3D floating card cascade hero.
 *
 * Meta AI / Apple keynote style:
 *  - Seven 28px-radius video cards drifting in a staggered 3D depth field
 *  - Active card sits in the foreground sweet-spot in crisp focus
 *  - Background cards hover at varied Z-depths with optical lens blur
 *  - Every 3s a seamless vertical cascade: the foreground card glides upward
 *    and recedes into the background stack gaining depth blur while the next
 *    card ascends from the bottom-right into sharp focus (silky ease-out)
 *  - Continuous, perfectly infinite 7-card loop that never pauses on hover
 *  - Each card runs a dual-layer crossfade loop so footage never snaps back
 *    to its first frame, and carries the module icon in a glass tile
 *
 * Stock footage placeholders live in /public/home_screen_videos_new — swap the
 * `video`/`poster` fields below with the final showcase renders when ready.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';

export interface HeroCardDeckAnimationProps {
  onSelect?: (mode: string) => void;
}

interface ShowcaseCard {
  id: string;
  mode: string;
  label: string;
  title: string;
  subtitle: string;
  video: string;
  poster: string;
  icon: string;
  accent: string;
  /** Loop start offset in seconds — lets two cards share one clip without looking identical */
  startAt?: number;
}

const NEW_VIDEOS = 'home_screen_videos_new';

const SHOWCASE_CARDS: ShowcaseCard[] = [
  {
    id: 'ignite',
    mode: 'junior',
    label: 'IGNITE · Junior Coding',
    title: 'Visual Block Studio',
    subtitle: 'Snap-together coding, stories and games',
    video: `${NEW_VIDEOS}/web/embed and ignite.mp4`,
    poster: `${NEW_VIDEOS}/embed and ignite.jpg`,
    icon: 'assets/ignite_icon.png',
    accent: '#f59e0b'
  },
  {
    id: 'embed',
    mode: 'intermediate',
    label: 'EMBED · Robotics & IoT',
    title: 'Arduino & Microcontrollers',
    subtitle: 'Live sensor telemetry and servo robotics',
    video: `${NEW_VIDEOS}/web/embed and ignite.mp4`,
    poster: `${NEW_VIDEOS}/embed and ignite.jpg`,
    icon: 'assets/arduino_icon.png',
    accent: '#06b6d4',
    startAt: 3
  },
  {
    id: 'logix',
    mode: 'python',
    label: 'LOGIX · Python Power',
    title: 'Algorithmic Logic',
    subtitle: 'Real-time code runner and visual algorithms',
    video: `${NEW_VIDEOS}/web/logix.mp4`,
    poster: `${NEW_VIDEOS}/logix.jpg`,
    icon: 'assets/python_icon.png',
    accent: '#3b82f6'
  },
  {
    id: 'neura',
    mode: 'neura',
    label: 'NEURA · AI & Vision',
    title: 'Computer Vision Lab',
    subtitle: 'Neural segmentation and live object tracking',
    video: `${NEW_VIDEOS}/web/neura.mp4`,
    poster: `${NEW_VIDEOS}/neura.jpg`,
    icon: 'assets/ml_brain_icon.png',
    accent: '#8b5cf6'
  },
  {
    id: 'electra',
    mode: 'electra',
    label: 'ELECTRA · Circuit Lab',
    title: 'Dynamic Circuit Simulator',
    subtitle: 'Electronics, current flow and oscilloscope',
    video: `${NEW_VIDEOS}/web/electra.mp4`,
    poster: `${NEW_VIDEOS}/electra.jpg`,
    icon: 'assets/creocad_icon.png',
    accent: '#10b981'
  },
  {
    id: 'vision3d',
    mode: 'vision3d',
    label: 'VISION3D · Spatial Design',
    title: '3D Modelling Studio',
    subtitle: 'Build, sculpt and animate in three dimensions',
    video: `${NEW_VIDEOS}/web/vision 3d.mp4`,
    poster: `${NEW_VIDEOS}/vision 3d.jpg`,
    icon: 'assets/vision3d_icon.png',
    accent: '#0ea5e9'
  },
  {
    id: 'creova',
    mode: 'creova',
    label: 'CREOVA · App & Game Dev',
    title: 'Interactive Project Builder',
    subtitle: 'Ship apps, games and media experiences',
    video: `${NEW_VIDEOS}/web/creova.mp4`,
    poster: `${NEW_VIDEOS}/creova.jpg`,
    icon: 'assets/app_game_dev_icon.png',
    accent: '#ec4899'
  }
];

const TOTAL = SHOWCASE_CARDS.length;
const LAYERS = 2;
const CYCLE_MS = 4500;
const TRANSITION_MS = 1250;
const TRANSITION_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
/** Crossfade starts well before the clip runs out, so a card is never seen ending */
const LOOP_SWAP_LEAD_MS = 1500;
const LOOP_FADE_MS = 800;

/**
 * Chromium can serve broken media cache entries (ERR_CACHE_READ_FAILURE /
 * ERR_CACHE_OPERATION_NOT_SUPPORTED), which shows up as black or frozen video
 * cards. A version query keeps every fetch clean — same trick the font loader
 * in index.html uses.
 */
const MEDIA_BUST = '?v=3';

/**
 * Depth-field slots indexed by a card's relative position (rel) to the active card.
 * rel 0 → foreground sweet-spot · rel 1 → inbound from bottom-right
 * rel 2 → hidden behind the deck · rel 3..6 → background stack (bottom-left,
 * top-left, top-right, and the just-departed card drifting upward).
 */
interface DepthSlot {
  x: number;
  y: number;
  z: number;
  scale: number;
  blur: number;
  dim: number;
  opacity: number;
  rotY: number;
  rotZ: number;
  zIndex: number;
}

const DEPTH_SLOTS: DepthSlot[] = [
  { x: 0, y: 0, z: 0, scale: 1, blur: 0, dim: 1, opacity: 1, rotY: 0, rotZ: 0, zIndex: 40 },
  { x: 44, y: 40, z: -240, scale: 0.78, blur: 1.8, dim: 1, opacity: 0.98, rotY: -8, rotZ: 2, zIndex: 30 },
  { x: 0, y: 30, z: -640, scale: 0.5, blur: 6, dim: 0.95, opacity: 0.1, rotY: 0, rotZ: 0, zIndex: 6 },
  { x: -54, y: 34, z: -450, scale: 0.6, blur: 4, dim: 0.98, opacity: 0.76, rotY: 10, rotZ: -3, zIndex: 10 },
  { x: -56, y: -34, z: -400, scale: 0.64, blur: 3.5, dim: 0.99, opacity: 0.8, rotY: 11, rotZ: -2.5, zIndex: 14 },
  { x: 54, y: -34, z: -350, scale: 0.66, blur: 2.8, dim: 1, opacity: 0.86, rotY: -10, rotZ: 2.5, zIndex: 16 },
  { x: 12, y: -56, z: -300, scale: 0.7, blur: 2, dim: 1, opacity: 0.92, rotY: -5, rotZ: -1.5, zIndex: 20 }
];

const KEYFRAMES = `
@keyframes hero-card-shine {
  0%   { transform: translateX(-160%) rotate(8deg); opacity: 0; }
  10%  { opacity: 0.55; }
  26%  { transform: translateX(180%) rotate(8deg); opacity: 0; }
  100% { transform: translateX(180%) rotate(8deg); opacity: 0; }
}
@keyframes hero-card-drift {
  0%   { transform: translate3d(0, 0, 0); }
  50%  { transform: translate3d(0, -9px, 0); }
  100% { transform: translate3d(0, 0, 0); }
}
`;

export const HeroCardDeckAnimation: React.FC<HeroCardDeckAnimationProps> = ({ onSelect }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [frontLayer, setFrontLayer] = useState<number[]>(() => SHOWCASE_CARDS.map(() => 0));

  const videoRefs = useRef<Array<Array<HTMLVideoElement | null>>>(
    SHOWCASE_CARDS.map(() => Array.from({ length: LAYERS }, () => null))
  );
  const frontLayerRef = useRef<number[]>(frontLayer);
  const currentIndexRef = useRef(currentIndex);
  const swapGuard = useRef<boolean[]>(SHOWCASE_CARDS.map(() => false));
  const swapTimers = useRef<Array<number | undefined>>([]);
  const readyTimers = useRef<Array<number | undefined>>([]);

  useEffect(() => {
    frontLayerRef.current = frontLayer;
  }, [frontLayer]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  const advance = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % TOTAL);
  }, []);

  /**
   * Crossfade loop: when the front layer nears the end of its clip the hidden
   * layer starts from the loop point and fades in, so footage never snaps
   * back to frame one on screen. The fade only starts once the incoming layer
   * has a decoded frame ready, so no black card ever flashes.
   */
  const handleLoopSwap = useCallback((index: number) => {
    if (swapGuard.current[index]) return;
    swapGuard.current[index] = true;

    const layers = videoRefs.current[index];
    const loopStart = SHOWCASE_CARDS[index].startAt ?? 0;
    const outgoingLayer = frontLayerRef.current[index];
    const outgoing = layers[outgoingLayer];
    const incoming = layers[1 - outgoingLayer];

    const begin = () => {
      window.clearTimeout(readyTimers.current[index]);
      if (incoming) {
        void incoming.play().catch(() => undefined);
      }
      setFrontLayer((prev) => {
        const next = [...prev];
        next[index] = 1 - outgoingLayer;
        return next;
      });
      window.clearTimeout(swapTimers.current[index]);
      swapTimers.current[index] = window.setTimeout(() => {
        if (outgoing) {
          outgoing.pause();
          outgoing.currentTime = loopStart;
        }
        swapGuard.current[index] = false;
      }, LOOP_FADE_MS + 120);
    };

    if (!incoming) {
      swapGuard.current[index] = false;
      return;
    }

    incoming.currentTime = loopStart;

    if (incoming.readyState >= 2) {
      begin();
    } else {
      let started = false;
      const onReady = () => {
        if (started) return;
        started = true;
        incoming.removeEventListener('loadeddata', onReady);
        incoming.removeEventListener('seeked', onReady);
        begin();
      };
      incoming.addEventListener('loadeddata', onReady);
      incoming.addEventListener('seeked', onReady);
      readyTimers.current[index] = window.setTimeout(onReady, 320);
    }
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  /* Seamless infinite cascade timing — never pauses, never waits */
  useEffect(() => {
    const timer = window.setTimeout(advance, CYCLE_MS);
    return () => window.clearTimeout(timer);
  }, [currentIndex, advance]);

  /* Only decode footage that is on-stage or just leaving it */
  useEffect(() => {
    SHOWCASE_CARDS.forEach((_, index) => {
      const layers = videoRefs.current[index];
      const rel = (index - currentIndex + TOTAL) % TOTAL;
      const shouldPlay = rel <= 1 || rel === TOTAL - 1;

      if (shouldPlay) {
        const front = layers[frontLayer[index]];
        if (front && front.paused) void front.play().catch(() => undefined);
      } else {
        layers.forEach((video) => {
          if (video && !video.paused) video.pause();
        });
      }
    });
  }, [currentIndex, frontLayer]);

  /**
   * Watchdog: whatever happens (blocked autoplay attempt, aborted load, seek
   * hiccup), the card in the spotlight always ends up playing. Runs gently so
   * it never fights an in-flight crossfade. It also kicks off the loop swap
   * for any clip approaching its end, so a card is never seen running out.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      SHOWCASE_CARDS.forEach((_, index) => {
        const layers = videoRefs.current[index];
        const rel = (index - currentIndexRef.current + TOTAL) % TOTAL;
        const onStage = rel <= 1 || rel === TOTAL - 1;
        if (!onStage || swapGuard.current[index]) return;
        const front = layers[frontLayerRef.current[index]];
        if (!front) return;

        if (front.ended) {
          handleLoopSwap(index);
          return;
        }
        if (front.paused) void front.play().catch(() => undefined);
        if (
          front.duration &&
          front.duration - front.currentTime <= LOOP_SWAP_LEAD_MS / 1000
        ) {
          handleLoopSwap(index);
        }
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [handleLoopSwap]);

  useEffect(() => {
    const swaps = swapTimers.current;
    const readies = readyTimers.current;
    return () => {
      swaps.forEach((timer) => window.clearTimeout(timer));
      readies.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const activeCard = SHOWCASE_CARDS[currentIndex];
  const transition = `transform ${TRANSITION_MS}ms ${TRANSITION_EASE}, filter ${TRANSITION_MS}ms ${TRANSITION_EASE}, opacity ${TRANSITION_MS}ms ${TRANSITION_EASE}`;

  return (
    <div className="group/herocascade relative w-full max-w-[720px] mx-auto select-none">
      <style>{KEYFRAMES}</style>

      <div
        className="relative w-full aspect-[16/11]"
        style={{ perspective: '1500px', perspectiveOrigin: '50% 46%' }}
      >
        {/* ── 3D depth field ── */}
        <div
          className="absolute left-1/2 top-[47%] w-[64%] aspect-[16/10]"
          style={{ transform: 'translate(-50%, -50%)', transformStyle: 'preserve-3d' }}
        >
          {SHOWCASE_CARDS.map((card, index) => {
            const rel = (index - currentIndex + TOTAL) % TOTAL;
            const slot = DEPTH_SLOTS[rel];
            const isActive = rel === 0;
            const isIncoming = rel === 1;
            const loopStart = card.startAt ?? 0;

            return (
              <div
                key={card.id}
                role={isActive ? 'button' : undefined}
                tabIndex={isActive ? 0 : undefined}
                aria-label={isActive ? `Open ${card.title}` : undefined}
                onClick={() => {
                  if (isActive) onSelect?.(card.mode);
                  else if (isIncoming) advance();
                }}
                onKeyDown={(event) => {
                  if (!isActive) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect?.(card.mode);
                  }
                }}
                className="absolute inset-0 outline-none"
                style={{
                  transform: `translate3d(${slot.x}%, ${slot.y}%, ${slot.z}px) rotateY(${slot.rotY}deg) rotate(${slot.rotZ}deg) scale(${slot.scale})`,
                  filter: `blur(${slot.blur}px) brightness(${slot.dim})`,
                  opacity: slot.opacity,
                  zIndex: slot.zIndex,
                  transition,
                  willChange: 'transform, filter, opacity',
                  cursor: isActive || isIncoming ? 'pointer' : 'default',
                  pointerEvents: slot.opacity < 0.3 ? 'none' : 'auto'
                }}
              >
                {/* Idle drift keeps the depth field alive without touching the cascade transform */}
                <div
                  className="w-full h-full"
                  style={
                    rel >= 2 && !reducedMotion
                      ? { animation: `hero-card-drift ${9 + (index % 3)}s ease-in-out ${(index % 5) * -1.6}s infinite` }
                      : undefined
                  }
                >
                  {/* Accent bloom on the focused card */}
                  <div
                    className="absolute -inset-6 rounded-[40px] blur-2xl pointer-events-none transition-opacity duration-1000"
                    style={{
                      background: `radial-gradient(ellipse at center, ${card.accent}66 0%, transparent 70%)`,
                      opacity: isActive ? 1 : 0
                    }}
                  />

                {/* Glass card shell — 28px radius */}
                <div className="relative w-full h-full rounded-[28px] overflow-hidden bg-[#e9eef6] shadow-[0_1px_0_rgba(255,255,255,0.5)_inset,0_30px_55px_-25px_rgba(2,6,23,0.5)]">
                  {/* Dual layers crossfade into each other for a seamless loop */}
                  {Array.from({ length: LAYERS }, (_, layer) => {
                    const isFront = frontLayer[index] === layer;
                    return (
                      <video
                        key={layer}
                        ref={(el) => {
                          videoRefs.current[index][layer] = el;
                          if (el) {
                            el.muted = true;
                            el.defaultMuted = true;
                          }
                        }}
                        src={`${card.video}${MEDIA_BUST}`}
                        poster={`${card.poster}${MEDIA_BUST}`}
                        muted
                        playsInline
                        preload="auto"
                        disablePictureInPicture
                        onError={(event) => {
                          const video = event.currentTarget;
                          if (video.dataset.cacheRetry === '1') return;
                          video.dataset.cacheRetry = '1';
                          video.src = `${card.video}?v=${Date.now()}`;
                          video.load();
                          const layers = videoRefs.current[index];
                          if (video === layers[frontLayerRef.current[index]]) {
                            void video.play().catch(() => undefined);
                          }
                        }}
                        onLoadedMetadata={(event) => {
                          const video = event.currentTarget;
                          if (loopStart && Math.abs(video.currentTime - loopStart) > 0.4) {
                            video.currentTime = loopStart;
                          }
                        }}
                        onTimeUpdate={(event) => {
                          const video = event.currentTarget;
                          if (!isFront || swapGuard.current[index] || !video.duration) return;
                          if (video.duration - video.currentTime <= LOOP_SWAP_LEAD_MS / 1000) {
                            handleLoopSwap(index);
                          }
                        }}
                        onEnded={() => {
                          if (isFront) handleLoopSwap(index);
                        }}
                        className="absolute inset-0 w-full h-full object-cover [filter:saturate(1.06)_contrast(1.03)]"
                        style={{
                          opacity: isFront ? 1 : 0,
                          transition: `opacity ${LOOP_FADE_MS}ms linear`
                        }}
                      />
                    );
                  })}

                  {/* Legibility scrim — light touch, bottom weighted only */}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#020617]/80 via-[#020617]/5 to-transparent pointer-events-none" />

                  {/* Rim light on the rounded glass border */}
                  <div className="absolute inset-0 rounded-[28px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16),inset_0_1px_0_rgba(255,255,255,0.4)] pointer-events-none" />

                  {/* Accent rim + soft glow on the focused card */}
                  <div
                    className="absolute inset-0 rounded-[28px] pointer-events-none transition-opacity duration-700"
                    style={{
                      opacity: isActive ? 1 : 0,
                      boxShadow: `inset 0 0 0 1.5px ${card.accent}80, 0 0 46px -8px ${card.accent}66`
                    }}
                  />

                  {/* Keynote shine sweep on the focused card */}
                  {isActive && !reducedMotion && (
                    <div className="absolute inset-y-0 -left-1/3 w-1/2 pointer-events-none mix-blend-overlay animate-[hero-card-shine_6s_ease-in-out_infinite]">
                      <div className="w-full h-full bg-gradient-to-r from-transparent via-white/60 to-transparent" />
                    </div>
                  )}

                  {/* Module icon + label chip */}
                  <div className="absolute left-4 top-4 flex items-center gap-2.5">
                    <span
                      className="w-9 h-9 rounded-xl bg-black/35 border border-white/20 flex items-center justify-center shrink-0"
                      style={{ boxShadow: `0 0 14px -2px ${card.accent}99` }}
                    >
                      <img src={card.icon} alt="" className="w-6 h-6 object-contain drop-shadow-sm" />
                    </span>
                    <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/90 px-2.5 py-1 rounded-full bg-black/40 border border-white/20">
                      {card.label}
                    </span>
                  </div>

                  {/* Foreground caption + launch affordance */}
                  {isActive && (
                    <div className="absolute inset-x-0 bottom-0 px-5 pb-4 pt-16 flex items-end justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="text-white font-extrabold text-[16px] sm:text-[17px] leading-tight tracking-tight drop-shadow-[0_2px_10px_rgba(2,6,23,0.65)]">
                          {card.title}
                        </h3>
                        <p className="text-white/75 text-[11.5px] leading-snug mt-0.5 line-clamp-1 drop-shadow-[0_2px_8px_rgba(2,6,23,0.6)]">
                          {card.subtitle}
                        </p>
                      </div>
                      {onSelect && (
                        <span
                          className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-bold text-white px-3.5 py-1.5 rounded-full border border-white/30 transition-colors duration-200 group-hover/herocascade:bg-white/25"
                          style={{ backgroundColor: `${card.accent}40` }}
                        >
                          Launch
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </div>
                  )}
                </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <span className="sr-only" aria-live="polite">{activeCard.title}</span>
    </div>
  );
};

export default HeroCardDeckAnimation;
