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
 *  - Continuous, perfectly infinite 7-card loop
 *
 * Stock footage placeholders live in /public/home_screen_videos — swap the
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
    video: `${NEW_VIDEOS}/embed and ignite.mp4`,
    poster: `${NEW_VIDEOS}/embed and ignite.jpg`,
    accent: '#f59e0b'
  },
  {
    id: 'embed',
    mode: 'intermediate',
    label: 'EMBED · Robotics & IoT',
    title: 'Arduino & Microcontrollers',
    subtitle: 'Live sensor telemetry and servo robotics',
    video: `${NEW_VIDEOS}/embed and ignite.mp4`,
    poster: `${NEW_VIDEOS}/embed and ignite.jpg`,
    accent: '#06b6d4',
    startAt: 5
  },
  {
    id: 'logix',
    mode: 'python',
    label: 'LOGIX · Python Power',
    title: 'Algorithmic Logic',
    subtitle: 'Real-time code runner and visual algorithms',
    video: `${NEW_VIDEOS}/logix.mp4`,
    poster: `${NEW_VIDEOS}/logix.jpg`,
    accent: '#3b82f6'
  },
  {
    id: 'neura',
    mode: 'neura',
    label: 'NEURA · AI & Vision',
    title: 'Computer Vision Lab',
    subtitle: 'Neural segmentation and live object tracking',
    video: `${NEW_VIDEOS}/neura.mp4`,
    poster: `${NEW_VIDEOS}/neura.jpg`,
    accent: '#8b5cf6'
  },
  {
    id: 'electra',
    mode: 'electra',
    label: 'ELECTRA · Circuit Lab',
    title: 'Dynamic Circuit Simulator',
    subtitle: 'Electronics, current flow and oscilloscope',
    video: `${NEW_VIDEOS}/electra.mp4`,
    poster: `${NEW_VIDEOS}/electra.jpg`,
    accent: '#10b981'
  },
  {
    id: 'vision3d',
    mode: 'vision3d',
    label: 'VISION3D · Spatial Design',
    title: '3D Modelling Studio',
    subtitle: 'Build, sculpt and animate in three dimensions',
    video: `${NEW_VIDEOS}/vision 3d.mp4`,
    poster: `${NEW_VIDEOS}/vision 3d.jpg`,
    accent: '#0ea5e9'
  },
  {
    id: 'creova',
    mode: 'creova',
    label: 'CREOVA · App & Game Dev',
    title: 'Interactive Project Builder',
    subtitle: 'Ship apps, games and media experiences',
    video: `${NEW_VIDEOS}/creova.mp4`,
    poster: `${NEW_VIDEOS}/creova.jpg`,
    accent: '#ec4899'
  }
];

const TOTAL = SHOWCASE_CARDS.length;
const CYCLE_MS = 3000;
const TRANSITION_MS = 1150;
const TRANSITION_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

/**
 * Depth-field slots indexed by a card's relative position (rel) to the active card.
 * rel 0 → foreground sweet-spot · rel 1 → inbound from bottom-right
 * rel 2 → hidden deep stage · rel 3..6 → background stack (bottom-left, top-left,
 * top-right, and the just-departed card drifting upward).
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
  { x: 36, y: 36, z: -220, scale: 0.85, blur: 1.8, dim: 0.95, opacity: 0.95, rotY: -7, rotZ: 1.5, zIndex: 30 },
  { x: 6, y: 22, z: -620, scale: 0.6, blur: 9, dim: 0.7, opacity: 0.18, rotY: 0, rotZ: 0, zIndex: 6 },
  { x: -50, y: 36, z: -430, scale: 0.68, blur: 6, dim: 0.82, opacity: 0.58, rotY: 9, rotZ: -2.5, zIndex: 10 },
  { x: -52, y: -36, z: -380, scale: 0.72, blur: 5, dim: 0.85, opacity: 0.62, rotY: 10, rotZ: -2, zIndex: 14 },
  { x: 48, y: -36, z: -330, scale: 0.78, blur: 3.6, dim: 0.88, opacity: 0.7, rotY: -9, rotZ: 2, zIndex: 16 },
  { x: 6, y: -48, z: -280, scale: 0.82, blur: 2.6, dim: 0.92, opacity: 0.78, rotY: -4, rotZ: -1, zIndex: 20 }
];

export const HeroCardDeckAnimation: React.FC<HeroCardDeckAnimationProps> = ({ onSelect }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);

  const advance = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % TOTAL);
  }, []);

  /* Respect reduced-motion preferences — no autoplay, no transitions */
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  /* Seamless infinite cascade timing */
  useEffect(() => {
    if (isHovered || reducedMotion) return;
    const timer = window.setTimeout(advance, CYCLE_MS);
    return () => window.clearTimeout(timer);
  }, [currentIndex, isHovered, reducedMotion, advance]);

  /* Only decode footage that is on-stage or just leaving it */
  useEffect(() => {
    SHOWCASE_CARDS.forEach((_, index) => {
      const video = videoRefs.current[index];
      if (!video) return;
      const rel = (index - currentIndex + TOTAL) % TOTAL;
      const shouldPlay = rel <= 1 || rel === TOTAL - 1;
      if (shouldPlay) {
        if (video.paused) void video.play().catch(() => undefined);
      } else if (!video.paused) {
        video.pause();
      }
    });
  }, [currentIndex]);

  const activeCard = SHOWCASE_CARDS[currentIndex];
  const transition = reducedMotion
    ? 'none'
    : `transform ${TRANSITION_MS}ms ${TRANSITION_EASE}, filter ${TRANSITION_MS}ms ${TRANSITION_EASE}, opacity ${TRANSITION_MS}ms ${TRANSITION_EASE}`;

  return (
    <div
      className="group/herocascade relative w-full max-w-[680px] mx-auto select-none"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className="relative w-full aspect-[16/11.5]"
        style={{ perspective: '1500px', perspectiveOrigin: '50% 46%' }}
      >
        {/* ── 3D depth field ── */}
        <div
          className="absolute left-1/2 top-[47%] w-[70%] aspect-[16/10]"
          style={{ transform: 'translate(-50%, -50%)', transformStyle: 'preserve-3d' }}
        >
          {SHOWCASE_CARDS.map((card, index) => {
            const rel = (index - currentIndex + TOTAL) % TOTAL;
            const slot = DEPTH_SLOTS[rel];
            const isActive = rel === 0;
            const isIncoming = rel === 1;

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
                {/* Accent bloom on the focused card */}
                <div
                  className="absolute -inset-6 rounded-[40px] blur-2xl pointer-events-none transition-opacity duration-1000"
                  style={{
                    background: `radial-gradient(ellipse at center, ${card.accent}59 0%, transparent 70%)`,
                    opacity: isActive ? 0.9 : 0
                  }}
                />

                {/* Glass card shell — 28px radius */}
                <div className="relative w-full h-full rounded-[28px] overflow-hidden bg-[#050b18] shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_34px_60px_-30px_rgba(2,6,23,0.65)]">
                  <video
                    ref={(el) => { videoRefs.current[index] = el; }}
                    src={card.video}
                    poster={card.poster}
                    muted
                    loop={card.startAt === undefined}
                    playsInline
                    preload="metadata"
                    disablePictureInPicture
                    onLoadedMetadata={(event) => {
                      const video = event.currentTarget;
                      if (card.startAt && Math.abs(video.currentTime - card.startAt) > 0.4) {
                        video.currentTime = card.startAt;
                      }
                    }}
                    onTimeUpdate={(event) => {
                      const video = event.currentTarget;
                      if (card.startAt === undefined || !video.duration) return;
                      if (video.currentTime >= video.duration - 0.4) {
                        video.currentTime = card.startAt;
                      }
                    }}
                    className="absolute inset-0 w-full h-full object-cover"
                  />

                  {/* Cinematic grade + legibility scrim */}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#020617]/90 via-[#020617]/15 to-[#020617]/25 pointer-events-none" />

                  {/* Rim light on the rounded glass border */}
                  <div className="absolute inset-0 rounded-[28px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14),inset_0_1px_0_rgba(255,255,255,0.32)] pointer-events-none" />
                  <div className="absolute inset-x-0 top-0 h-[36%] rounded-t-[28px] bg-gradient-to-b from-white/[0.14] via-white/[0.03] to-transparent pointer-events-none" />

                  {/* Label chip */}
                  <div className="absolute left-4 top-4 flex items-center gap-2">
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: card.accent, boxShadow: `0 0 10px ${card.accent}` }}
                    />
                    <span className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/85 px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/15">
                      {card.label}
                    </span>
                  </div>

                  {/* Foreground caption + launch affordance */}
                  {isActive && (
                    <div className="absolute inset-x-0 bottom-0 px-5 pb-4 pt-16 flex items-end justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="text-white font-extrabold text-[16px] sm:text-[17px] leading-tight tracking-tight">
                          {card.title}
                        </h3>
                        <p className="text-white/60 text-[11.5px] leading-snug mt-0.5 line-clamp-1">
                          {card.subtitle}
                        </p>
                      </div>
                      {onSelect && (
                        <span
                          className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-bold text-white px-3.5 py-1.5 rounded-full border border-white/25 backdrop-blur-md transition-colors duration-200 group-hover/herocascade:bg-white/20"
                          style={{ backgroundColor: `${card.accent}33` }}
                        >
                          Launch
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </div>
                  )}
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
