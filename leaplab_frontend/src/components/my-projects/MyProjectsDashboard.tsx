/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 */
import React, { useEffect, useState, useRef, lazy, Suspense } from 'react';
import {
    ArrowLeft,
    Trash2,
    Share2,
    Calendar,
    ChevronLeft,
    ChevronRight,
    Cpu,
    Lock,
    FolderOpen,
    AlertTriangle,
    Code,
    Brain,
    Layers,
    Tv,
    Search,
    X,
    Compass
} from 'lucide-react';
import { LMS_API_BASE } from '../../config/api';
import { useLeapLabAuthStore } from '../../auth/leaplabAuthStore';
import {
    listMyProjects,
    getCloudProject,
    fetchCloudProjectContent,
    deleteCloudProject,
    CloudProject,
} from '../../services/cloudProjectApi';
import ShareProjectModal from './ShareProjectModal';
import { useCloudProjectStore } from '../../store/cloudProjectStore';
import { isPacked, unpack } from '../../Electra/Client/utils/compress';
import '../../Electra/Client/utils/elements/leap-elements';

interface MyProjectsDashboardProps {
    onOpenProject: (mode: string) => void;
}

interface ModuleMeta {
    label: string;
    icon: string;
    accent: string;
    gradient: string;
    darkAccent: string;
}

const MODULES: Record<string, ModuleMeta> = {
    junior: {
        label: 'Ignite',
        icon: 'assets/ignite_icon.png',
        accent: '#F97316',
        gradient: 'linear-gradient(135deg, rgba(249, 115, 22, 0.05) 0%, rgba(251, 146, 60, 0.1) 100%)',
        darkAccent: '#C2410C',
    },
    intermediate: {
        label: 'Embed',
        icon: 'assets/arduino_icon.png',
        accent: '#59aaa4',
        gradient: 'linear-gradient(135deg, rgba(89, 170, 164, 0.05) 0%, rgba(139, 211, 206, 0.1) 100%)',
        darkAccent: '#0F766E',
    },
    python: {
        label: 'Logix',
        icon: 'assets/python_icon.png',
        accent: '#3B82F6',
        gradient: 'linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(96, 165, 250, 0.1) 100%)',
        darkAccent: '#1D4ED8',
    },
    neura: {
        label: 'Neura',
        icon: 'assets/ml_brain_icon.png',
        accent: '#4648d4',
        gradient: 'linear-gradient(135deg, rgba(70, 72, 212, 0.05) 0%, rgba(96, 99, 238, 0.1) 100%)',
        darkAccent: '#2f2ebe',
    },
    electra: {
        label: 'Electra',
        icon: 'assets/creocad_icon.png',
        accent: '#22C55E',
        gradient: 'linear-gradient(135deg, rgba(34, 197, 94, 0.05) 0%, rgba(74, 222, 128, 0.1) 100%)',
        darkAccent: '#15803D',
    },
    creova: {
        label: 'Creova',
        icon: 'assets/app_game_dev_icon.png',
        accent: '#EC4899',
        gradient: 'linear-gradient(135deg, rgba(236, 72, 153, 0.05) 0%, rgba(244, 114, 182, 0.1) 100%)',
        darkAccent: '#BE185D',
    },
    vision3d: {
        label: 'Vision3D',
        icon: 'assets/vision3d_icon.png',
        accent: '#6366F1',
        gradient: 'linear-gradient(135deg, rgba(99, 102, 241, 0.05) 0%, rgba(129, 140, 248, 0.1) 100%)',
        darkAccent: '#4338CA',
    },
};

// Generates a modern abstract SVG representing the project's domain instead of repeating the logo
const renderCardVisual = (mode: string, projectName: string) => {
    const seed = projectName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const accent = MODULES[mode]?.accent || '#6366F1';

    switch (mode) {
        case 'electra':
        case 'intermediate':
            return (
                <div className="relative flex-1 min-h-0 w-full bg-white flex items-center justify-center overflow-hidden visual-electra">
                    <svg viewBox="0 0 200 110" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                            <pattern id={`grid-${seed}`} width="12" height="12" patternUnits="userSpaceOnUse">
                                <path d="M 12 0 L 0 0 0 12" fill="none" stroke="rgba(34, 197, 94, 0.07)" strokeWidth="0.5" />
                            </pattern>
                        </defs>
                        <rect width="100%" height="100%" fill={`url(#grid-${seed})`} rx="8" />
                        {/* Interactive schematic look */}
                        <path d={`M 20 55 H 80 L 100 ${seed % 2 === 0 ? '25' : '85'} H 140`} stroke={accent} strokeWidth="1.5" strokeDasharray="3 3" opacity="0.6" />
                        <path d={`M 40 85 H 105 L 125 ${seed % 2 === 0 ? '90' : '20'} H 175`} stroke={accent} strokeWidth="1" opacity="0.4" />

                        {/* Glowing Connection Nodes */}
                        <circle cx="100" cy={seed % 2 === 0 ? '25' : '85'} r="3.5" fill={accent} className="animate-pulse" />
                        <circle cx="125" cy={seed % 2 === 0 ? '90' : '20'} r="2.5" fill={accent} />

                        {/* Stylized microcontroller block */}
                        <rect x="80" y="40" width="40" height="30" rx="3" fill="#0F172A" stroke={accent} strokeWidth="1.5" />
                        <line x1="88" y1="36" x2="88" y2="40" stroke={accent} strokeWidth="1" />
                        <line x1="96" y1="36" x2="96" y2="40" stroke={accent} strokeWidth="1" />
                        <line x1="104" y1="36" x2="104" y2="40" stroke={accent} strokeWidth="1" />
                        <line x1="112" y1="36" x2="112" y2="40" stroke={accent} strokeWidth="1" />
                        <line x1="88" y1="70" x2="88" y2="74" stroke={accent} strokeWidth="1" />
                        <line x1="96" y1="70" x2="96" y2="74" stroke={accent} strokeWidth="1" />
                        <line x1="104" y1="70" x2="104" y2="74" stroke={accent} strokeWidth="1" />
                        <line x1="112" y1="70" x2="112" y2="74" stroke={accent} strokeWidth="1" />
                        <Cpu size={18} color="#FFF" className="absolute left-[91px] top-[46px] opacity-90" />
                    </svg>
                </div>
            );
        case 'python':
            return (
                <div className="relative flex-1 min-h-0 w-full bg-white flex items-center justify-center overflow-hidden visual-python">
                    <svg viewBox="0 0 200 110" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect width="100%" height="100%" fill="rgba(59, 130, 246, 0.02)" rx="8" />
                        {/* Stylized code terminal */}
                        <rect x="10" y="10" width="180" height="90" rx="6" fill="#0B0F19" stroke="rgba(255,255,255,0.04)" strokeWidth="1.5" />
                        <circle cx="22" cy="22" r="3" fill="#EF4444" />
                        <circle cx="32" cy="22" r="3" fill="#F59E0B" />
                        <circle cx="42" cy="22" r="3" fill="#10B981" />

                        <text x="20" y="45" fontSize="8" fontFamily="monospace" fill="#3B82F6" fontWeight="bold">&gt;&gt; {projectName.substring(0, 14)}</text>
                        <text x="20" y="60" fontSize="7" fontFamily="monospace" fill="#64748B">status: compiled successfully</text>
                        <text x="20" y="75" fontSize="7" fontFamily="monospace" fill="#10B981">executing blockly modules...</text>

                        <path d="M160 70 L170 80 L160 90" stroke={accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </div>
            );
        case 'neura':
            return (
                <div className="relative flex-1 min-h-0 w-full bg-white flex items-center justify-center overflow-hidden visual-neura">
                    <svg viewBox="0 0 200 110" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect width="100%" height="100%" fill="rgba(168, 85, 247, 0.02)" rx="8" />
                        {/* Synapse network nodes */}
                        <line x1="30" y1="55" x2="80" y2="25" stroke="rgba(168, 85, 247, 0.25)" strokeWidth="1" />
                        <line x1="30" y1="55" x2="80" y2="85" stroke="rgba(168, 85, 247, 0.25)" strokeWidth="1" />
                        <line x1="80" y1="25" x2="140" y2="55" stroke="rgba(168, 85, 247, 0.25)" strokeWidth="1" />
                        <line x1="80" y1="85" x2="140" y2="55" stroke="rgba(168, 85, 247, 0.25)" strokeWidth="1" />
                        <line x1="80" y1="25" x2="80" y2="85" stroke="rgba(168, 85, 247, 0.15)" strokeWidth="0.75" />

                        <circle cx="30" cy="55" r="6" fill="#A855F7" />
                        <circle cx="80" cy="25" r="4.5" fill="#C084FC" />
                        <circle cx="80" cy="85" r="4.5" fill="#C084FC" />
                        <circle cx="140" cy="55" r="8" fill="#E979F9" />
                        <circle cx="140" cy="55" r="12" stroke="#E979F9" strokeWidth="0.75" strokeDasharray="3 3" opacity="0.8" />
                        <Brain size={14} color="#FFF" className="absolute left-[133px] top-[48px]" />
                    </svg>
                </div>
            );
        case 'vision3d':
            return (
                <div className="relative flex-1 min-h-0 w-full bg-white flex items-center justify-center overflow-hidden visual-vision3d">
                    <svg viewBox="0 0 200 110" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect width="100%" height="100%" fill="rgba(99, 102, 241, 0.02)" rx="8" />
                        {/* 3D cube */}
                        <g transform="translate(60, 25)">
                            <path d="M0 30 L40 0 L80 30 L40 60 Z" fill="rgba(99, 102, 241, 0.15)" stroke={accent} strokeWidth="1.5" strokeLinejoin="round" />
                            <path d="M0 30 L0 70 L40 100 L40 60 Z" fill="rgba(99, 102, 241, 0.1)" stroke={accent} strokeWidth="1.2" strokeLinejoin="round" />
                            <path d="M40 60 L40 100 L80 70 L80 30 Z" fill="rgba(99, 102, 241, 0.08)" stroke={accent} strokeWidth="1.2" strokeLinejoin="round" />
                            <circle cx="40" cy="50" r="2.5" fill={accent} />
                            <circle cx="60" cy="20" r="2" fill={accent} />
                            <circle cx="25" cy="66" r="2" fill={accent} />
                        </g>
                        {/* Orbit path */}
                        <ellipse cx="100" cy="85" rx="35" ry="8" stroke={accent} strokeWidth="0.75" strokeDasharray="2 3" fill="none" opacity="0.3" />
                        <circle cx="135" cy="85" r="2" fill={accent} opacity="0.5" />
                    </svg>
                </div>
            );
        case 'creova':
            return (
                <div className="relative flex-1 min-h-0 w-full bg-white flex items-center justify-center overflow-hidden visual-creova">
                    <svg viewBox="0 0 200 110" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect width="100%" height="100%" fill="rgba(236, 72, 153, 0.02)" rx="8" />
                        {/* Device frame preview */}
                        <rect x="65" y="15" width="70" height="80" rx="8" fill="#1E293B" stroke={accent} strokeWidth="1.5" />
                        <rect x="71" y="21" width="58" height="52" rx="4" fill="#0F172A" />
                        <circle cx="100" cy="84" r="3" fill="#EC4899" />

                        {/* UI Blocks inside preview */}
                        <rect x="77" y="28" width="20" height="12" rx="2" fill="#EC4899" opacity="0.8" />
                        <circle cx="110" cy="34" r="4" fill="#3B82F6" />
                        <line x1="77" y1="48" x2="105" y2="48" stroke="rgba(255,255,255,0.2)" strokeWidth="2" strokeLinecap="round" />
                        <line x1="77" y1="56" x2="115" y2="56" stroke="rgba(255,255,255,0.15)" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                </div>
            );
        default:
            return (
                <div className="relative flex-1 min-h-0 w-full bg-white flex items-center justify-center overflow-hidden visual-default">
                    <svg viewBox="0 0 200 110" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect width="100%" height="100%" fill="rgba(99, 102, 241, 0.02)" rx="8" />
                        <path d="M100 25 L145 75 H55 Z" stroke={accent} strokeWidth="1.5" strokeLinejoin="round" fill="none" />
                        <circle cx="100" cy="50" r="7" fill={accent} opacity="0.4" />
                    </svg>
                </div>
            );
    }
};

const renderHeaderBackgroundVisual = (mode: string) => {
    const accent = MODULES[mode]?.accent || '#6366F1';

    switch (mode) {
        case 'electra':
        case 'intermediate':
            return (
                <div className="absolute top-0 right-0 bottom-0 w-[65%] pointer-events-none z-0 opacity-[0.85] mask-image-[linear-gradient(to_left,rgba(0,0,0,1)_0%,rgba(0,0,0,0.8)_40%,rgba(0,0,0,0)_100%)] [-webkit-mask-image:linear-gradient(to_left,rgba(0,0,0,1)_0%,rgba(0,0,0,0.8)_40%,rgba(0,0,0,0)_100%)]">
                    <svg viewBox="0 0 800 120" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
                        <defs>
                            <linearGradient id="header-grad-electra" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="transparent" />
                                <stop offset="50%" stopColor="rgba(34, 197, 94, 0.01)" />
                                <stop offset="100%" stopColor="rgba(34, 197, 94, 0.12)" />
                            </linearGradient>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#header-grad-electra)" />
                        <path d="M 400 60 H 600 L 620 30 H 680 L 690 60 H 750" stroke={accent} strokeWidth="1.5" strokeDasharray="4 4" opacity="0.25" />
                        <path d="M 500 90 H 550 L 570 110 H 660 L 675 75 H 780" stroke={accent} strokeWidth="1.2" opacity="0.18" />
                        <path d="M 450 30 H 530 L 540 50 H 590 L 600 10 H 700" stroke={accent} strokeWidth="1" opacity="0.12" />

                        <path d="M 648 20 V 40 M 652 20 V 40 M 644 30 H 648 M 652 30 H 656" stroke={accent} strokeWidth="1.5" opacity="0.3" />
                        <path d="M 560 50 H 565 L 568 45 L 571 55 L 574 45 L 577 55 L 580 45 L 583 55 L 586 50 H 590" stroke={accent} strokeWidth="1.5" opacity="0.3" />

                        <circle cx="600" cy="60" r="3.5" fill={accent} opacity="0.4" />
                        <circle cx="620" cy="30" r="2.5" fill={accent} opacity="0.3" />
                        <circle cx="680" cy="30" r="2.5" fill={accent} opacity="0.3" />
                        <circle cx="690" cy="60" r="3.5" fill={accent} opacity="0.4" />
                        <circle cx="570" cy="110" r="3" fill={accent} opacity="0.3" />
                        <circle cx="660" cy="110" r="3" fill={accent} opacity="0.3" />
                        <circle cx="675" cy="75" r="2" fill={accent} opacity="0.3" />
                    </svg>
                </div>
            );
        case 'python':
            return (
                <div className="absolute top-0 right-0 bottom-0 w-[65%] pointer-events-none z-0 opacity-[0.85] mask-image-[linear-gradient(to_left,rgba(0,0,0,1)_0%,rgba(0,0,0,0.8)_40%,rgba(0,0,0,0)_100%)] [-webkit-mask-image:linear-gradient(to_left,rgba(0,0,0,1)_0%,rgba(0,0,0,0.8)_40%,rgba(0,0,0,0)_100%)]">
                    <svg viewBox="0 0 800 120" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
                        <defs>
                            <linearGradient id="header-grad-python" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="transparent" />
                                <stop offset="50%" stopColor="rgba(59, 130, 246, 0.01)" />
                                <stop offset="100%" stopColor="rgba(59, 130, 246, 0.1)" />
                            </linearGradient>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#header-grad-python)" />
                        <text x="480" y="30" fontFamily="monospace" fontSize="9" fill={accent} opacity="0.15">def init_workspace():</text>
                        <text x="500" y="45" fontFamily="monospace" fontSize="9" fill={accent} opacity="0.12">    load_modules(active=True)</text>
                        <text x="500" y="60" fontFamily="monospace" fontSize="9" fill={accent} opacity="0.12">    compile_blocks()</text>
                        <text x="500" y="75" fontFamily="monospace" fontSize="9" fill={accent} opacity="0.15">    return System.live_run()</text>

                        <text x="680" y="40" fontFamily="monospace" fontSize="11" fill={accent} opacity="0.25" fontWeight="bold">&lt;/&gt;</text>
                        <text x="710" y="85" fontFamily="monospace" fontSize="10" fill={accent} opacity="0.18">&gt;&gt;&gt; sys.ready</text>

                        <path d="M 450 15 H 750 V 105 H 450 Z" stroke={accent} strokeWidth="1" strokeDasharray="8 8" opacity="0.08" />
                    </svg>
                </div>
            );
        case 'neura':
            return (
                <div className="absolute top-0 right-0 bottom-0 w-[65%] pointer-events-none z-0 opacity-[0.85] mask-image-[linear-gradient(to_left,rgba(0,0,0,1)_0%,rgba(0,0,0,0.8)_40%,rgba(0,0,0,0)_100%)] [-webkit-mask-image:linear-gradient(to_left,rgba(0,0,0,1)_0%,rgba(0,0,0,0.8)_40%,rgba(0,0,0,0)_100%)]">
                    <svg viewBox="0 0 800 120" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
                        <defs>
                            <linearGradient id="header-grad-neura" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="transparent" />
                                <stop offset="50%" stopColor="rgba(168, 85, 247, 0.01)" />
                                <stop offset="100%" stopColor="rgba(168, 85, 247, 0.12)" />
                            </linearGradient>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#header-grad-neura)" />
                        <line x1="520" y1="60" x2="600" y2="30" stroke={accent} strokeWidth="1" opacity="0.15" />
                        <line x1="520" y1="60" x2="600" y2="90" stroke={accent} strokeWidth="1" opacity="0.15" />
                        <line x1="600" y1="30" x2="680" y2="60" stroke={accent} strokeWidth="1" opacity="0.15" />
                        <line x1="600" y1="90" x2="680" y2="60" stroke={accent} strokeWidth="1" opacity="0.15" />
                        <line x1="680" y1="60" x2="760" y2="30" stroke={accent} strokeWidth="1" opacity="0.15" />
                        <line x1="680" y1="60" x2="760" y2="90" stroke={accent} strokeWidth="1" opacity="0.15" />
                        <line x1="600" y1="30" x2="600" y2="90" stroke={accent} strokeWidth="0.75" opacity="0.1" />
                        <line x1="680" y1="60" x2="680" y2="10" stroke={accent} strokeWidth="0.75" opacity="0.1" />

                        <circle cx="520" cy="60" r="4" fill={accent} opacity="0.3" />
                        <circle cx="600" cy="30" r="5" fill={accent} opacity="0.25" />
                        <circle cx="600" cy="90" r="5" fill={accent} opacity="0.25" />
                        <circle cx="680" cy="60" r="6" fill={accent} opacity="0.35" />
                        <circle cx="760" cy="30" r="4" fill={accent} opacity="0.25" />
                        <circle cx="760" cy="90" r="4" fill={accent} opacity="0.25" />
                        <circle cx="680" cy="60" r="10" stroke={accent} strokeWidth="0.75" strokeDasharray="2 2" opacity="0.3" />
                    </svg>
                </div>
            );
        case 'creova':
            return (
                <div className="absolute top-0 right-0 bottom-0 w-[65%] pointer-events-none z-0 opacity-[0.85] mask-image-[linear-gradient(to_left,rgba(0,0,0,1)_0%,rgba(0,0,0,0.8)_40%,rgba(0,0,0,0)_100%)] [-webkit-mask-image:linear-gradient(to_left,rgba(0,0,0,1)_0%,rgba(0,0,0,0.8)_40%,rgba(0,0,0,0)_100%)]">
                    <svg viewBox="0 0 800 120" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
                        <defs>
                            <linearGradient id="header-grad-creova" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="transparent" />
                                <stop offset="50%" stopColor="rgba(236, 72, 153, 0.01)" />
                                <stop offset="100%" stopColor="rgba(236, 72, 153, 0.12)" />
                            </linearGradient>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#header-grad-creova)" />
                        <rect x="580" y="20" width="60" height="80" rx="6" stroke={accent} strokeWidth="1" opacity="0.2" fill="none" />
                        <rect x="585" y="25" width="50" height="50" rx="3" stroke={accent} strokeWidth="0.75" opacity="0.15" fill="none" />
                        <circle cx="610" cy="85" r="2.5" fill={accent} opacity="0.25" />

                        <path d="M 520 60 H 580" stroke={accent} strokeWidth="0.75" strokeDasharray="3 3" opacity="0.2" />
                        <path d="M 640 40 H 700 L 720 60 H 760" stroke={accent} strokeWidth="1" opacity="0.18" />
                        <circle cx="700" cy="40" r="2.5" fill={accent} opacity="0.3" />

                        <line x1="680" y1="10" x2="680" y2="110" stroke={accent} strokeWidth="0.5" strokeDasharray="2 4" opacity="0.1" />
                        <line x1="480" y1="80" x2="780" y2="80" stroke={accent} strokeWidth="0.5" strokeDasharray="2 4" opacity="0.1" />
                    </svg>
                </div>
            );
        case 'junior':
            return (
                <div className="absolute top-0 right-0 bottom-0 w-[65%] pointer-events-none z-0 opacity-[0.85] mask-image-[linear-gradient(to_left,rgba(0,0,0,1)_0%,rgba(0,0,0,0.8)_40%,rgba(0,0,0,0)_100%)] [-webkit-mask-image:linear-gradient(to_left,rgba(0,0,0,1)_0%,rgba(0,0,0,0.8)_40%,rgba(0,0,0,0)_100%)]">
                    <svg viewBox="0 0 800 120" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
                        <defs>
                            <linearGradient id="header-grad-junior" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="transparent" />
                                <stop offset="50%" stopColor="rgba(249, 115, 22, 0.01)" />
                                <stop offset="100%" stopColor="rgba(249, 115, 22, 0.12)" />
                            </linearGradient>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#header-grad-junior)" />
                        <path d="M 520 40 H 540 A 5 5 0 0 1 550 40 H 570 V 60 A 5 5 0 0 1 570 70 H 520 Z" stroke={accent} strokeWidth="1.2" opacity="0.25" fill="none" />
                        <path d="M 580 60 H 600 A 5 5 0 0 1 610 60 H 630 V 80 A 5 5 0 0 1 630 90 H 580 Z" stroke={accent} strokeWidth="1.2" opacity="0.18" fill="none" />

                        <circle cx="670" cy="30" r="3" fill={accent} opacity="0.2" />
                        <circle cx="700" cy="75" r="4.5" fill={accent} opacity="0.25" />
                        <circle cx="740" cy="45" r="2.5" fill={accent} opacity="0.2" />

                        <path d="M 680 70 C 680 50, 720 50, 720 70 C 720 90, 680 90, 680 70" stroke={accent} strokeWidth="1" strokeDasharray="3 3" opacity="0.15" />
                    </svg>
                </div>
            );
        case 'vision3d':
            return (
                <div className="absolute top-0 right-0 bottom-0 w-[65%] pointer-events-none z-0 opacity-[0.85] mask-image-[linear-gradient(to_left,rgba(0,0,0,1)_0%,rgba(0,0,0,0.8)_40%,rgba(0,0,0,0)_100%)] [-webkit-mask-image:linear-gradient(to_left,rgba(0,0,0,1)_0%,rgba(0,0,0,0.8)_40%,rgba(0,0,0,0)_100%)]">
                    <svg viewBox="0 0 800 120" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
                        <defs>
                            <linearGradient id="header-grad-vision3d" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="transparent" />
                                <stop offset="50%" stopColor="rgba(99, 102, 241, 0.01)" />
                                <stop offset="100%" stopColor="rgba(99, 102, 241, 0.12)" />
                            </linearGradient>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#header-grad-vision3d)" />
                        {/* 3D wireframe cube */}
                        <path d="M 560 40 L 590 25 L 630 25 L 630 65 L 600 80 L 560 80 Z" stroke={accent} strokeWidth="1" opacity="0.2" fill="none" />
                        <path d="M 590 25 L 590 65 L 560 80" stroke={accent} strokeWidth="1" opacity="0.15" fill="none" />
                        <path d="M 590 65 L 630 65" stroke={accent} strokeWidth="1" opacity="0.15" fill="none" />
                        {/* 3D axes */}
                        <line x1="680" y1="90" x2="720" y2="90" stroke={accent} strokeWidth="1.2" opacity="0.3" />
                        <line x1="680" y1="90" x2="680" y2="50" stroke={accent} strokeWidth="1.2" opacity="0.3" />
                        <line x1="680" y1="90" x2="710" y2="70" stroke={accent} strokeWidth="1.2" opacity="0.3" />
                        <circle cx="680" cy="90" r="3" fill={accent} opacity="0.35" />
                        <circle cx="720" cy="90" r="2.5" fill={accent} opacity="0.3" />
                        <circle cx="680" cy="50" r="2.5" fill={accent} opacity="0.3" />
                        <circle cx="710" cy="70" r="2.5" fill={accent} opacity="0.3" />
                        {/* Grid dots */}
                        <circle cx="500" cy="100" r="1.5" fill={accent} opacity="0.15" />
                        <circle cx="520" cy="100" r="1.5" fill={accent} opacity="0.15" />
                        <circle cx="540" cy="100" r="1.5" fill={accent} opacity="0.15" />
                        <circle cx="560" cy="100" r="1.5" fill={accent} opacity="0.15" />
                        <circle cx="580" cy="100" r="1.5" fill={accent} opacity="0.15" />
                    </svg>
                </div>
            );
        default:
            return (
                <div className="absolute top-0 right-0 bottom-0 w-[65%] pointer-events-none z-0 opacity-[0.85] mask-image-[linear-gradient(to_left,rgba(0,0,0,1)_0%,rgba(0,0,0,0.8)_40%,rgba(0,0,0,0)_100%)] [-webkit-mask-image:linear-gradient(to_left,rgba(0,0,0,1)_0%,rgba(0,0,0,0.8)_40%,rgba(0,0,0,0)_100%)]">
                    <svg viewBox="0 0 800 120" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
                        <defs>
                            <linearGradient id="header-grad-default" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="transparent" />
                                <stop offset="100%" stopColor="rgba(99, 102, 241, 0.08)" />
                            </linearGradient>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#header-grad-default)" />
                        <path d="M 500 20 L 520 40 L 500 60" stroke={accent} strokeWidth="1" opacity="0.15" />
                        <path d="M 600 80 L 620 100 L 600 120" stroke={accent} strokeWidth="1" opacity="0.15" />
                        <circle cx="700" cy="50" r="8" stroke={accent} strokeWidth="1" strokeDasharray="4 4" opacity="0.15" />
                    </svg>
                </div>
            );
    }
};

interface SavedProjectCardVisualProps {
    projectId: string;
    fileUrl: string | null;
    mode: string;
    projectName: string;
    accent: string;
}

const Vision3DCardVisual: React.FC<{ shapes: any[]; accent: string }> = ({ shapes, accent }) => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current || !shapes || !Array.isArray(shapes) || shapes.length === 0) return;

        const container = containerRef.current;
        const width = container.clientWidth || 200;
        const height = container.clientHeight || 110;

        let cleanup: (() => void) | null = null;

        const initThree = async () => {
            const THREE = await import('three');

            // Renderer
            const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            renderer.setSize(width, height);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            container.appendChild(renderer.domElement);

            // Scene
            const scene = new THREE.Scene();

            // Lights
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
            scene.add(ambientLight);
            const dirLight = new THREE.DirectionalLight(0xffffff, 0.95);
            dirLight.position.set(8, 12, 10);
            scene.add(dirLight);

            // Group to hold all shapes for bounding box calculations
            const group = new THREE.Group();

            // Build meshes
            const meshes: any[] = [];
            shapes.forEach((shape: any) => {
                if (shape.visible === false || shape.type === 'group') return;

                let geometry: any;
                const w = shape.width ?? 2;
                const h = shape.height ?? shape.cylinderHeight ?? shape.coneHeight ?? shape.pyramidHeight ?? shape.tubeHeight ?? shape.polygonHeight ?? 2;
                const d = shape.depth ?? 2;

                switch (shape.type) {
                    case 'box':
                        geometry = new THREE.BoxGeometry(w, h, d);
                        break;
                    case 'cylinder':
                        geometry = new THREE.CylinderGeometry(shape.radiusTop ?? 1, shape.radiusBottom ?? 1, h, 16);
                        break;
                    case 'sphere':
                        geometry = new THREE.SphereGeometry(shape.radius ?? 1, 16, 12);
                        break;
                    case 'cone':
                        geometry = new THREE.ConeGeometry(shape.coneRadius ?? 1, h, 16);
                        break;
                    case 'torus':
                        geometry = new THREE.TorusGeometry(shape.torusRadius ?? 1, shape.tubeRadius ?? 0.4, 8, 24);
                        break;
                    case 'pyramid':
                        geometry = new THREE.ConeGeometry(shape.pyramidRadius ?? 1, h, shape.pyramidSides ?? 4);
                        break;
                    case 'halfSphere':
                        geometry = new THREE.SphereGeometry(shape.halfSphereRadius ?? 1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
                        break;
                    case 'tube':
                        geometry = new THREE.CylinderGeometry(shape.tubeOuterRadius ?? 1, shape.tubeOuterRadius ?? 1, h, 16);
                        break;
                    case 'ring':
                        geometry = new THREE.RingGeometry(shape.innerRadius ?? 0.5, shape.outerRadius ?? 1, 16);
                        break;
                    default:
                        geometry = new THREE.BoxGeometry(w, h, d);
                        break;
                }

                // Material
                const isHole = shape.isHole === true;
                const material = new THREE.MeshStandardMaterial({
                    color: new THREE.Color(isHole ? '#cbd5e1' : (shape.color || accent)),
                    metalness: shape.metalness ?? 0.1,
                    roughness: shape.roughness ?? 0.7,
                    transparent: isHole || (shape.opacity ?? 1) < 1,
                    opacity: isHole ? 0.35 : (shape.opacity ?? 1),
                    wireframe: isHole
                });

                const mesh = new THREE.Mesh(geometry, material);
                mesh.position.set(shape.position?.[0] || 0, shape.position?.[1] || 0, shape.position?.[2] || 0);
                mesh.rotation.set(shape.rotation?.[0] || 0, shape.rotation?.[1] || 0, shape.rotation?.[2] || 0);
                mesh.scale.set(shape.scale?.[0] || 1, shape.scale?.[1] || 1, shape.scale?.[2] || 1);

                group.add(mesh);
                meshes.push(mesh);
            });

            scene.add(group);

            // Center and compute bounding box to frame the camera
            const box = new THREE.Box3().setFromObject(group);
            const center = new THREE.Vector3();
            box.getCenter(center);
            const size = new THREE.Vector3();
            box.getSize(size);

            // Move group center to origin for rendering consistency
            group.position.sub(center);

            // Camera positioning (isometric style view)
            const maxDim = Math.max(size.x, size.y, size.z, 2);
            const fov = 45;
            const cameraValue = maxDim * 1.5;

            const camera = new THREE.PerspectiveCamera(fov, width / height, 0.1, 1000);
            camera.position.set(cameraValue, cameraValue * 0.8, cameraValue);
            camera.lookAt(0, 0, 0);

            // Grid helper for Tinkercad workspace feel
            const gridHelper = new THREE.GridHelper(Math.max(maxDim * 3, 10), 10, new THREE.Color(accent), new THREE.Color('#e2e8f0'));
            gridHelper.position.y = -size.y / 2 - 0.01;
            scene.add(gridHelper);

            // Single static render
            renderer.render(scene, camera);

            cleanup = () => {
                if (container.contains(renderer.domElement)) {
                    container.removeChild(renderer.domElement);
                }
                meshes.forEach(mesh => {
                    mesh.geometry.dispose();
                    if (Array.isArray(mesh.material)) {
                        mesh.material.forEach((m: any) => m.dispose());
                    } else {
                        mesh.material.dispose();
                    }
                });
                gridHelper.geometry.dispose();
                if (Array.isArray(gridHelper.material)) {
                    gridHelper.material.forEach(m => m.dispose());
                } else {
                    gridHelper.material.dispose();
                }
                renderer.dispose();
            };
        };

        initThree();

        return () => {
            cleanup?.();
        };
    }, [shapes, accent]);

    return (
        <div
            ref={containerRef}
            className="relative flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden actual-vision3d-canvas bg-indigo-500/[0.04] h-[110px] rounded-lg"
        />
    );
};

const SavedProjectCardVisual: React.FC<SavedProjectCardVisualProps> = ({ projectId, fileUrl, mode, projectName, accent }) => {
    const [loading, setLoading] = useState(true);
    const [projectContent, setProjectContent] = useState<any | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                let url = fileUrl;
                if (!url && projectId) {
                    const fullProject = await getCloudProject(projectId);
                    url = fullProject.fileUrl;
                }

                if (!url) {
                    if (!cancelled) setLoading(false);
                    return;
                }

                const fullUrl = url.startsWith('http')
                    ? url
                    : `${LMS_API_BASE}${url}`;

                const response = await fetch(fullUrl);
                if (!response.ok) throw new Error('Failed to load project content');
                const text = await response.text();

                let content;
                try {
                    content = isPacked(text) ? unpack<any>(text) : JSON.parse(text);
                } catch (parseErr) {
                    console.error('[SavedProjectCardVisual] Failed to parse content:', parseErr);
                    content = null;
                }

                if (content && !cancelled) {
                    setProjectContent(content);
                }
            } catch (err) {
                console.error('[SavedProjectCardVisual] Failed to load content:', err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [fileUrl, projectId]);

    if (loading) {
        return (
            <div className="absolute inset-0 flex items-center justify-center bg-white">
                <div className="w-5 h-5 border-2 border-white/10 rounded-full animate-[spin_0.8s_linear_infinite]" style={{ borderTopColor: accent }} />
            </div>
        );
    }

    if (!projectContent) {
        return renderCardVisual(mode, projectName);
    }

    // ── Mode 1: Electra (Circuit Canvas) ──
    if (mode === 'electra') {
        const nodes = projectContent.nodes || projectContent.circuit?.nodes || [];
        const edges = projectContent.edges || projectContent.circuit?.edges || [];
        if (!Array.isArray(nodes) || nodes.length === 0) {
            return renderCardVisual(mode, projectName);
        }

        const padding = 50;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        nodes.forEach((n: any) => {
            const x = n.position?.x ?? 0;
            const y = n.position?.y ?? 0;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        });

        if (minX === Infinity || maxX === -Infinity || minY === Infinity || maxY === -Infinity) {
            minX = 0; maxX = 800; minY = 0; maxY = 600;
        }

        const width = Math.max(maxX - minX + padding * 2, 200);
        const height = Math.max(maxY - minY + padding * 2, 110);
        const viewBox = `${minX - padding} ${minY - padding} ${width} ${height}`;

        return (
            <div className="relative flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden">
                <svg viewBox={viewBox} fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full p-0 transition-all duration-300">
                    <defs>
                        <pattern id="card-circuit-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(15, 23, 42, 0.05)" strokeWidth="0.5" />
                        </pattern>
                    </defs>
                    <rect x={minX - padding} y={minY - padding} width={width} height={height} fill="url(#card-circuit-grid)" />

                    {Array.isArray(edges) && edges.map((edge: any) => {
                        const srcNode = nodes.find((n: any) => n.id === edge.source);
                        const tgtNode = nodes.find((n: any) => n.id === edge.target?.replace('__target', ''));
                        if (!srcNode || !tgtNode) return null;

                        const waypoints = edge.data?.waypoints || [];
                        const color = edge.data?.color || accent;

                        if (Array.isArray(waypoints) && waypoints.length > 0) {
                            const pointsString = [
                                { x: srcNode.position?.x ?? 0, y: srcNode.position?.y ?? 0 },
                                ...waypoints,
                                { x: tgtNode.position?.x ?? 0, y: tgtNode.position?.y ?? 0 }
                            ].map(pt => `${pt.x},${pt.y}`).join(' ');

                            return (
                                <polyline
                                    key={edge.id}
                                    points={pointsString}
                                    stroke={color}
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    opacity="0.8"
                                />
                            );
                        }

                        return (
                            <line
                                key={edge.id}
                                x1={srcNode.position?.x ?? 0}
                                y1={srcNode.position?.y ?? 0}
                                x2={tgtNode.position?.x ?? 0}
                                y2={tgtNode.position?.y ?? 0}
                                stroke={color}
                                strokeWidth="2"
                                strokeLinecap="round"
                                opacity="0.8"
                            />
                        );
                    })}

                    {nodes.map((node: any) => {
                        const x = node.position?.x ?? 0;
                        const y = node.position?.y ?? 0;
                        const rawType = node.data?.type || 'resistor';
                        const elementType = rawType === 'lcd1602-i2c' ? 'lcd1602' : rawType === 'lcd2004-i2c' ? 'lcd2004' : rawType;
                        const TagName = `leap-${elementType}`;
                        const rotation = node.data?.rotation || 0;

                        let compWidth = 120, compHeight = 120;
                        if (['arduino-uno', 'arduino-mega'].includes(elementType)) {
                            compWidth = 280; compHeight = 210;
                        } else if (['esp32-c3', 'esp32', 'nano-rp2040-connect', 'arduino-nano'].includes(elementType)) {
                            compWidth = 160; compHeight = 160;
                        } else if (['lcd1602', 'lcd2004', 'ili9341', 'ili9341-touch', 'membrane-keypad', 'led-ring', 'neopixel-matrix'].includes(elementType)) {
                            compWidth = 220; compHeight = 180;
                        }

                        const mappedProps: any = { ...node.data, simulating: false };
                        if (elementType === 'led') {
                            mappedProps.value = node.data.brightness ? true : false;
                            mappedProps.color = node.data.color || 'red';
                        } else if (elementType === 'servo' || elementType === 'stepper-motor') {
                            mappedProps.angle = node.data.angle ?? 0;
                        } else if (['potentiometer', 'slide-potentiometer'].includes(elementType)) {
                            mappedProps.value = node.data.sensorValues?.value ?? 0;
                        } else if (['dc-motor', 'water-pump', 'motor', 'stepper-motor'].includes(elementType)) {
                            mappedProps.speed = 0;
                            mappedProps.running = false;
                            mappedProps.animating = false;
                        }

                        return (
                            <foreignObject
                                key={node.id}
                                x={x - compWidth / 2}
                                y={y - compHeight / 2}
                                width={compWidth}
                                height={compHeight}
                                className="overflow-visible pointer-events-none"
                            >
                                <div className="w-full h-full flex items-center justify-center" style={{ transform: `rotate(${rotation}deg)`, transformOrigin: 'center center' }}>
                                    {React.createElement(TagName, mappedProps)}
                                </div>
                            </foreignObject>
                        );
                    })}
                </svg>
            </div>
        );
    }

    // ── Mode 2: Logix / Python (Code Session View) ──
    if (mode === 'python') {
        let rawCode = projectContent.code || '';
        if (!rawCode && projectContent.projectFiles) {
            const files = projectContent.projectFiles;
            rawCode = files['main.py'] || Object.values(files)[0] || '';
        }
        if (!rawCode) rawCode = `# ${projectName}\nimport time\n\ndef main():\n    print("System active")\n    time.sleep(1)\n\nif __name__ == "__main__":\n    main()`;

        const codeLines = rawCode.split('\n').slice(0, 6);

        return (
            <div className="relative flex-1 min-h-0 w-full flex flex-col p-[8px_10px] font-mono overflow-hidden">
                <div className="flex items-center gap-[5px] pb-[6px] border-b border-white/[0.08] mb-[6px]">
                    <span className="dot dot-red w-[7px] h-[7px] rounded-full" />
                    <span className="dot dot-yellow w-[7px] h-[7px] rounded-full" />
                    <span className="dot dot-green w-[7px] h-[7px] rounded-full" />
                    <span className="text-[10px] text-[#94a3b8] ml-1 font-semibold">{projectContent.activeFile || 'main.py'}</span>
                </div>
                <div className="flex flex-col gap-[3px] text-[10px] leading-[1.3]">
                    {codeLines.map((line: string, i: number) => {
                        const keywords = ['import', 'from', 'def', 'class', 'return', 'if', 'else', 'elif', 'while', 'for', 'in', 'print', 'True', 'False', 'None', 'async', 'await'];
                        const parts: { text: string; isKeyword: boolean }[] = [];
                        let remaining = line;
                        while (remaining.length > 0) {
                            let earliestIndex = remaining.length;
                            let earliestKeyword = '';
                            for (const kw of keywords) {
                                const idx = remaining.indexOf(kw);
                                if (idx !== -1 && idx < earliestIndex) {
                                    earliestIndex = idx;
                                    earliestKeyword = kw;
                                }
                            }
                            if (earliestKeyword && earliestIndex < remaining.length) {
                                if (earliestIndex > 0) parts.push({ text: remaining.slice(0, earliestIndex), isKeyword: false });
                                parts.push({ text: earliestKeyword, isKeyword: true });
                                remaining = remaining.slice(earliestIndex + earliestKeyword.length);
                            } else {
                                parts.push({ text: remaining, isKeyword: false });
                                remaining = '';
                            }
                        }
                        return (
                            <div key={i} className="flex gap-2 whitespace-pre overflow-hidden">
                                <span className="text-[#475569] select-none w-3 text-right">{i + 1}</span>
                                <span className="text-[#e2e8f0]">
                                    {parts.map((part, j) =>
                                        part.isKeyword ? (
                                            <span key={j} className="kw text-[#3b82f6] font-bold">{part.text}</span>
                                        ) : (
                                            <span key={j}>{part.text}</span>
                                        )
                                    )}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    // ── Mode 3: Creova (Phone Canvas View) ──
    if (mode === 'creova') {
        const screens = projectContent.screens || [];
        const activeScreen = screens[0] || {};
        const components = activeScreen.components || [];
        const appTitle = projectContent.appName || activeScreen.name || projectName;

        return (
            <div className="relative flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden p-1.5">
                <div className="w-[105px] h-[98px] bg-[#0f172a] rounded-xl p-1 shadow-[0_4px_12px_rgba(0,0,0,0.2)] border-[1.5px] border-[#334155] relative flex flex-col">
                    <div className="w-6 h-[3px] bg-[#334155] rounded-sm mx-auto mb-[3px]" />
                    <div className="flex-1 rounded-md overflow-hidden flex flex-col shadow-[inset_0_0_4px_rgba(0,0,0,0.1)]" style={{ backgroundColor: activeScreen.backgroundColor || '#F8FAFC' }}>
                        <div className="h-4 text-white text-[8px] font-bold flex items-center px-[6px] whitespace-nowrap overflow-hidden text-ellipsis" style={{ backgroundColor: activeScreen.titleBarColor || accent }}>
                            <span>{appTitle}</span>
                        </div>
                        <div className="p-1.5 flex flex-col gap-1 flex-1">
                            {components.length > 0 ? (
                                components.slice(0, 4).map((comp: any, idx: number) => {
                                    const type = comp.type || comp.componentType || 'Label';
                                    const text = comp.text || comp.props?.text || comp.name || type;

                                    if (type.includes('Button')) {
                                        return (
                                            <div key={idx} className="h-[14px] rounded-[3px] text-white text-[7px] font-bold flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.15)]" style={{ backgroundColor: comp.props?.backgroundColor || accent }}>
                                                {text}
                                            </div>
                                        );
                                    }
                                    if (type.includes('TextBox') || type.includes('Input')) {
                                        return (
                                            <div key={idx} className="h-[13px] bg-white border border-[#cbd5e1] rounded-[3px] px-1 text-[7px] text-[#94a3b8] flex items-center">
                                                <span>{text}</span>
                                            </div>
                                        );
                                    }
                                    if (type.includes('Slider')) {
                                        return (
                                            <div key={idx} className="h-2 relative flex items-center">
                                                <div className="w-full h-[3px] bg-[#cbd5e1] rounded-sm" />
                                                <div className="w-[6px] h-[6px] rounded-full absolute left-[40%]" style={{ backgroundColor: accent }} />
                                            </div>
                                        );
                                    }
                                    if (type.includes('Switch') || type.includes('Toggle')) {
                                        return (
                                            <div key={idx} className="flex items-center justify-between text-[7px] text-[#334155]">
                                                <span>{text}</span>
                                                <div className="w-3 h-[6px] bg-[#22c55e] rounded-[3px]" />
                                            </div>
                                        );
                                    }
                                    return (
                                        <div key={idx} className="text-[7px] font-semibold leading-none" style={{ color: comp.props?.textColor || '#1E293B' }}>
                                            {text}
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="flex flex-col gap-1 mt-1">
                                    <div className="h-3 rounded-[3px] text-white text-[7px] flex items-center justify-center" style={{ backgroundColor: accent }}>Welcome</div>
                                    <div className="h-[11px] bg-white border border-[#e2e8f0] text-[6px] text-[#94a3b8] px-1 flex items-center">Enter details...</div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── Mode 6: Vision3D (3D WebGL Canvas View) ──
    if (mode === 'vision3d') {
        const shapes = projectContent.shapes || [];
        return (
            <Vision3DCardVisual shapes={shapes} accent={accent} />
        );
    }

    // ── Mode 4 & 5: Junior (Ignite) & Intermediate (Embed) (Workspace Stage View) ──
    const scene = projectContent.scenes?.[0] || projectContent;
    const spritesList = scene.sprites || projectContent.sprites || [];
    const backdropName = scene.backdropName || scene.name || (mode === 'junior' ? 'Ignite Stage' : 'Embed Stage');

    return (
        <div className="relative flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden flex flex-col p-[6px_8px]">
            <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.1)_1px,transparent_1px)] bg-[size:10px_10px] opacity-80" />

            {/* Stage Top Controls Bar */}
            <div className="flex items-center justify-between z-[2] mb-[6px]">
                <div className="flex items-center gap-1 bg-[rgba(15,23,42,0.6)] py-[2px] px-[6px] rounded-[10px] border border-white/10">
                    <span className="text-[10px] cursor-default" title="Run script">🚩</span>
                    <span className="text-[10px] cursor-default" title="Stop">🛑</span>
                </div>
                <span className="text-[9px] font-bold text-[#94a3b8] bg-white/[0.05] py-[2px] px-[6px] rounded uppercase tracking-[0.5px]">{backdropName}</span>
            </div>

            <div className="flex items-center justify-between flex-1 z-[2] gap-2">
                {/* Left Column: Visual Blockly Script Preview Stack */}
                <div className="flex flex-col gap-[2px]">
                    <div className="py-[3px] px-2 rounded text-[8px] font-bold text-white font-[system-ui,-apple-system,sans-serif] shadow-[0_2px_4px_rgba(0,0,0,0.2)] whitespace-nowrap bg-[#eab308] rounded-tl-[6px] rounded-tr-[6px]">when 🚩 clicked</div>
                    <div className="py-[3px] px-2 rounded text-[8px] font-bold text-white font-[system-ui,-apple-system,sans-serif] shadow-[0_2px_4px_rgba(0,0,0,0.2)] whitespace-nowrap bg-[#3b82f6]">move 10 steps</div>
                    <div className="py-[3px] px-2 rounded text-[8px] font-bold text-white font-[system-ui,-apple-system,sans-serif] shadow-[0_2px_4px_rgba(0,0,0,0.2)] whitespace-nowrap bg-[#a855f7]">say Hello!</div>
                </div>

                {/* Right Column: Character Sprites Stage Canvas */}
                <div className="flex items-center justify-center flex-1">
                    {Array.isArray(spritesList) && spritesList.length > 0 ? (
                        spritesList.slice(0, 2).map((sprite: any, idx: number) => {
                            const name = sprite.name || `Sprite ${idx + 1}`;
                            const costumeSrc = sprite.costumeUrl || sprite.icon || (typeof sprite.costumes === 'object' ? (sprite.costumes[sprite.currentCostume] || sprite.costumes.default) : null);
                            const finalSrc = costumeSrc && !costumeSrc.startsWith('http') && !costumeSrc.startsWith('/') ? `/${costumeSrc}` : costumeSrc;

                            return (
                                <div key={idx} className="flex flex-col items-center gap-1">
                                    {finalSrc ? (
                                        <img src={finalSrc} alt={name} className="w-12 h-12 object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.4)]" onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
                                    ) : (
                                        <div className="w-[42px] h-[42px] rounded-xl flex items-center justify-center shadow-[0_4px_12px_rgba(0,0,0,0.3)] border-2 border-white/20" style={{ backgroundColor: accent }}>
                                            <Cpu size={18} color="#FFF" />
                                        </div>
                                    )}
                                    <span className="text-[9px] font-extrabold text-[#f8fafc] bg-[rgba(15,23,42,0.8)] py-[2px] px-[6px] rounded-md border border-white/[0.15]">{name}</span>
                                </div>
                            );
                        })
                    ) : (
                        <div className="flex flex-col items-center gap-1">
                            <div className="w-[42px] h-[42px] rounded-xl flex items-center justify-center shadow-[0_4px_12px_rgba(0,0,0,0.3)] border-2 border-white/20" style={{ backgroundColor: accent }}>
                                <Cpu size={20} color="#FFF" />
                            </div>
                            <span className="text-[9px] font-extrabold text-[#f8fafc] bg-[rgba(15,23,42,0.8)] py-[2px] px-[6px] rounded-md border border-white/[0.15]">Robot</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

interface ProjectBoardBadgeProps {
    project: CloudProject;
}

const ProjectBoardBadge: React.FC<ProjectBoardBadgeProps> = ({ project }) => {
    const [board, setBoard] = useState<string | null>(() => {
        if (project.metadata) {
            try {
                const parsed = typeof project.metadata === 'string' ? JSON.parse(project.metadata) : project.metadata;
                if (parsed?.board) return parsed.board;
            } catch (e) { }
        }
        return null;
    });

    useEffect(() => {
        if (board) return;
        let cancelled = false;
        (async () => {
            try {
                if (!project.fileUrl) return;
                const fullUrl = project.fileUrl.startsWith('http')
                    ? project.fileUrl
                    : `${LMS_API_BASE}${project.fileUrl}`;
                const res = await fetch(fullUrl);
                if (!res.ok) return;
                const text = await res.text();
                const content = isPacked(text) ? unpack<any>(text) : JSON.parse(text);
                const loadedNodes = content.nodes || content.circuit?.nodes || [];
                const detectedBoard = content.board || (loadedNodes.some((n: any) => n.data?.type === 'esp32-c3' || n.data?.type === 'esp32') ? 'esp32-c3' : 'arduino-uno');
                if (!cancelled && detectedBoard) {
                    setBoard(detectedBoard);
                }
            } catch (err) { }
        })();
        return () => { cancelled = true; };
    }, [project.fileUrl, project.metadata, board]);

    if (project.mode !== 'electra' && project.mode !== 'intermediate') return null;
    const targetBoard = board || 'arduino-uno';

    const displayLabel = (targetBoard === 'esp32-c3' || targetBoard === 'esp32') ? 'ESP32-C3' : 'Arduino Uno';
    const isEsp32 = targetBoard === 'esp32-c3' || targetBoard === 'esp32';

    return (
        <span 
            className={`inline-flex items-center py-1 px-2.5 rounded-full text-[9px] font-extrabold tracking-wider uppercase whitespace-nowrap border shadow-sm leading-none shrink-0`}
            style={{ 
                color: isEsp32 ? '#7c3aed' : '#008184',
                borderColor: isEsp32 ? 'rgba(139,92,246,0.2)' : 'rgba(0,151,157,0.2)',
                background: isEsp32 ? 'linear-gradient(135deg, rgba(124,58,237,0.03), rgba(124,58,237,0.06))' : 'linear-gradient(135deg, rgba(0,129,132,0.03), rgba(0,129,132,0.06))'
            }}
        >
            <span className="w-1 h-1 rounded-full mr-1.5 animate-pulse" style={{ backgroundColor: isEsp32 ? '#7c3aed' : '#008184' }} />
            {displayLabel}
        </span>
    );
};

interface DeleteConfirmationModalProps {
    projectName: string;
    onConfirm: () => void;
    onCancel: () => void;
}

const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({ projectName, onConfirm, onCancel }) => {
    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-md flex items-center justify-center z-[9999] p-4" onClick={onCancel}>
            <div
                className="w-full max-w-[400px] bg-white rounded-3xl p-8 shadow-[0_25px_50px_rgba(0,0,0,0.25)] border border-slate-200/60 relative flex flex-col items-center text-center"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Close Button */}
                <button
                    className="absolute top-4 right-4 w-8 h-8 rounded-xl text-slate-400 bg-transparent border-none cursor-pointer flex items-center justify-center hover:bg-slate-100 hover:text-slate-600 transition-colors"
                    onClick={onCancel}
                    title="Close"
                >
                    <X size={16} />
                </button>

                {/* Icon */}
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-red-50 to-red-100 text-red-600 flex items-center justify-center mb-5 shadow-sm border border-red-200/50">
                    <AlertTriangle size={24} strokeWidth={2} />
                </div>

                {/* Title */}
                <h3 className="m-0 mb-2 text-lg font-bold text-slate-900 tracking-tight">Delete Project</h3>

                {/* Description */}
                <p className="m-0 mb-8 text-sm text-slate-500 leading-relaxed max-w-[320px]">
                    Are you sure you want to delete <strong className="font-semibold text-slate-900">"{projectName}"</strong>? This action cannot be undone.
                </p>

                {/* Action Buttons */}
                <div className="flex items-center gap-3 w-full">
                    <button
                        className="flex-1 h-11 bg-white border border-slate-200 rounded-xl text-slate-600 text-sm font-semibold cursor-pointer shadow-sm hover:bg-slate-50 transition-colors"
                        onClick={onCancel}
                    >
                        Cancel
                    </button>
                    <button
                        className="flex-1 h-11 bg-gradient-to-br from-red-600 to-red-700 border-none rounded-xl text-white text-sm font-semibold cursor-pointer flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(220,38,38,0.25)] hover:shadow-lg transition-all"
                        onClick={onConfirm}
                    >
                        <Trash2 size={16} />
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
};

export default function MyProjectsDashboard({ onOpenProject }: MyProjectsDashboardProps) {
    const { isAuthenticated } = useLeapLabAuthStore();
    const [projects, setProjects] = useState<CloudProject[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [projectToDelete, setProjectToDelete] = useState<CloudProject | null>(null);
    const [openingId, setOpeningId] = useState<string | null>(null);
    const [sharingProject, setSharingProject] = useState<CloudProject | null>(null);
    const [selectedMode, setSelectedMode] = useState<string | null>(() => {
        return sessionStorage.getItem('myProjectsSelectedMode') || null;
    });
    const [searchQuery, setSearchQuery] = useState('');
    const { setPendingProject } = useCloudProjectStore();

    const scrollRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // No longer needed - scroll is handled by .page { overflow-y: auto } in CSS
    }, [selectedMode]);

    useEffect(() => {
        if (!isAuthenticated) {
            setLoading(false);
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                setError(null);
                const data = await listMyProjects();
                if (!cancelled) setProjects(data);
            } catch (err: any) {
                if (!cancelled) setError(err?.message || 'Failed to load projects');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [isAuthenticated]);

    const handleScroll = (direction: 'left' | 'right') => {
        if (scrollRef.current) {
            const { scrollLeft } = scrollRef.current;
            const scrollAmount = 300; // Match card width + gap
            const scrollTo = direction === 'left' ? scrollLeft - scrollAmount : scrollLeft + scrollAmount;
            scrollRef.current.scrollTo({ left: scrollTo, behavior: 'smooth' });
        }
    };

    const handleOpenProject = async (project: CloudProject) => {
        if (openingId) return;
        setOpeningId(project.id);
        try {
            const fullProject = await getCloudProject(project.id);
            if (!fullProject.fileUrl) {
                throw new Error('Project file URL is missing');
            }

            const fileUrl = fullProject.fileUrl.startsWith('http')
                ? fullProject.fileUrl
                : `${LMS_API_BASE}${fullProject.fileUrl}`;

            const content = await fetchCloudProjectContent(fileUrl);

            // Curriculum protection: if this project is not owned by current user, treat as read-only curriculum
            // Student edits must be saved as a separate copy, not overwrite the LMS master.
            const currentCredentialId = useLeapLabAuthStore.getState().credentialId;
            const isCurriculum = !!currentCredentialId && !!project.credentialId && project.credentialId !== currentCredentialId;
            const isSharedViewer = !!project.isShared && project.sharePermission === 'viewer';
            const shouldProtect = isCurriculum || isSharedViewer;

            if (shouldProtect) {
                // Mark content as curriculum copy – student edits will create a new cloud project
                const protectedContent = {
                    ...content,
                    isCurriculumCopy: true,
                    originalCurriculumId: project.id,
                    originalCurriculumName: project.name,
                    // Also store in projectData for Neura persistence
                    projectData: {
                        ...(content.projectData || {}),
                        isCurriculumCopy: true,
                        originalCurriculumId: project.id,
                    }
                };
                setPendingProject({
                    mode: project.mode,
                    data: protectedContent,
                    projectName: `${project.name} - Copy`,
                });
                // Do NOT set activeProjectId – Save will create a new student copy via saveProjectToCloud
                useCloudProjectStore.getState().clearActiveProjectId();
                // Clear any stale IDB auto-save for this type so curriculum edits don't pollute student workspace
                try {
                    const { deleteNeuraProject } = await import('../../neura/storage/neuraIDB');
                    // For Neura types, clear the type-keyed IDB so curriculum doesn't overwrite student's last work
                    // We don't auto-delete here – let the new copy create fresh IDB on save
                } catch {}
            } else {
                setPendingProject({
                    mode: project.mode,
                    data: content,
                    projectName: project.name,
                });
                useCloudProjectStore.getState().setActiveProjectId(project.id);
            }
            useCloudProjectStore.getState().clearSharedProjectInfo();

            onOpenProject(project.mode);
        } catch (err: any) {
            console.error('[MyProjectsDashboard] Failed to open project:', err);
            alert(err?.message || 'Failed to open project');
        } finally {
            setOpeningId(null);
        }
    };

    const handleDeleteProject = (e: React.MouseEvent, project: CloudProject) => {
        e.stopPropagation();
        setProjectToDelete(project);
    };

    const confirmDeleteProject = async () => {
        if (!projectToDelete) return;
        const project = projectToDelete;
        setProjectToDelete(null);
        setDeletingId(project.id);
        try {
            await deleteCloudProject(project.id);
            setProjects((prev) => prev.filter((p) => p.id !== project.id));
        } catch (err: any) {
            console.error('[MyProjectsDashboard] Failed to delete project:', err);
            alert(err?.message || 'Failed to delete project');
        } finally {
            setDeletingId(null);
        }
    };

    const handleShareProject = (e: React.MouseEvent, project: CloudProject) => {
        e.stopPropagation();
        setSharingProject(project);
    };

    const handleShareUpdate = (updatedProject: CloudProject) => {
        setProjects((prev) =>
            prev.map((p) => (p.id === updatedProject.id ? updatedProject : p))
        );
        setSharingProject(updatedProject);
    };

    const renderShareButton = (project: CloudProject) => (
        <button
            className={`cursor-pointer w-8 h-8 rounded-full flex items-center justify-center bg-white border border-[#e2e8f0]/40 text-[#64748b] shadow-sm transition-all duration-300 hover:bg-[rgba(37,99,235,0.08)] hover:text-[#2563eb] hover:border-[rgba(37,99,235,0.2)] hover:scale-110 ${project.isShared === 1 ? 'bg-[rgba(37,99,235,0.1)] text-[#2563eb] border border-[rgba(37,99,235,0.3)]' : ''}`}
            onClick={(e) => handleShareProject(e, project)}
            title={project.isShared === 1 ? 'Manage sharing' : 'Share project'}
        >
            <Share2 size={16} />
        </button>
    );

    const formatDate = (dateString: string | null) => {
        if (!dateString) return 'Unknown date';
        try {
            return new Date(dateString).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
            });
        } catch {
            return 'Unknown date';
        }
    };

    const escapeRegExp = (str: string) => {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    const highlightMatch = (text: string, query: string) => {
        if (!query.trim()) return text;
        const escapedQuery = escapeRegExp(query.trim());
        const parts = text.split(new RegExp(`(${escapedQuery})`, 'gi'));
        const lowerQuery = query.trim().toLowerCase();
        return (
            <>
                {parts.map((part, index) =>
                    part.toLowerCase() === lowerQuery ? (
                        <mark key={index} className="bg-[#fef08a] text-[#0f172a] px-[2px] rounded font-bold">
                            {part}
                        </mark>
                    ) : (
                        part
                    )
                )}
            </>
        );
    };

    const groupedProjects = projects.reduce((acc, project) => {
        const mode = project.mode || 'unknown';
        if (!acc[mode]) acc[mode] = [];
        acc[mode].push(project);
        return acc;
    }, {} as Record<string, CloudProject[]>);

    const sortedModes = ['junior', 'intermediate', 'python', 'neura', 'electra', 'vision3d', 'creova'];

    if (!isAuthenticated) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-8 bg-white/40 backdrop-blur-[12px] border border-[rgba(226,232,240,0.6)] rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.04)] my-6 mx-0">
                <div className="flex items-center justify-center w-20 h-20 rounded-full bg-[#f1f5f9] text-[#64748b] mb-6">
                    <Lock size={44} />
                </div>
                <h3 className="text-[22px] font-extrabold text-[#0f172a] m-0 mb-[10px]">Sign in to see your projects</h3>
                <p className="text-sm text-[#64748b] max-w-[380px] m-0 mb-6 leading-relaxed">Your saved LeapLab projects will appear here after you sign in.</p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-8 bg-white/40 backdrop-blur-[12px] border border-[rgba(226,232,240,0.6)] rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.04)] my-6 mx-0">
                <div className="w-12 h-12 border-4 border-[#f1f5f9] border-t-[#4f46e5] rounded-full animate-[spin_0.8s_linear_infinite] mb-5" />
                <p>Loading your projects...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-8 bg-white/40 backdrop-blur-[12px] border border-[rgba(226,232,240,0.6)] rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.04)] my-6 mx-0">
                <div className="flex items-center justify-center w-20 h-20 rounded-full bg-[#f1f5f9] text-[#64748b] mb-6">
                    <AlertTriangle size={44} color="#EF4444" />
                </div>
                <p className="text-sm text-[#64748b] max-w-[380px] m-0 mb-6 leading-relaxed">{error}</p>
                <button className="py-3 px-6 rounded-full border-none bg-[#4f46e5] text-white font-bold text-sm cursor-pointer shadow-[0_4px_12px_rgba(79,70,229,0.2)] hover:bg-[#4338ca] hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(79,70,229,0.3)] transition-all duration-300" onClick={() => window.location.reload()}>Retry</button>
            </div>
        );
    }

    // Module selection view
    if (!selectedMode) {
        return (
            <div 
                ref={containerRef}
                className="w-full max-w-full m-0 box-border overflow-x-hidden animate-[fadeIn_0.4s_ease-out] font-sans p-12"
            >
                <div className="text-center flex flex-col items-center justify-center mb-12">
                    <h2 className="text-[36px] font-extrabold text-[#0f172a] mb-2 tracking-[-0.02em]">My Workspace</h2>
                    <p className="text-[15px] text-[#64748b] mb-0 font-medium">Select a module category to access your files</p>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] justify-center gap-7 mb-12 w-full max-w-full">
                    {sortedModes.map((mode) => {
                        const meta = MODULES[mode];
                        const modeProjects = groupedProjects[mode] || [];
                        return (
                            <button
                                key={mode}
                                className="relative flex flex-col justify-end text-left rounded-[20px] p-0 w-full max-w-[320px] min-h-[260px] transition-all duration-300 shadow-[0_4px_20px_rgba(0,0,0,0.08)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.15)] hover:-translate-y-1 overflow-hidden cursor-pointer group border-0 bg-gradient-to-b from-white/95 via-slate-100/90 to-slate-300/85"
                                onClick={() => {
                                    setSelectedMode(mode);
                                    sessionStorage.setItem('myProjectsSelectedMode', mode);
                                }}
                            >
                                {/* Top accent bar */}
                                <div className="absolute top-0 left-0 w-full h-[4px] z-[3] opacity-100" style={{ backgroundColor: meta?.accent || '#6366f1' }} />

                                {/* Icon area */}
                                <div className="flex-1 flex items-center justify-center overflow-hidden relative w-full">
                                    <img
                                        src={meta?.icon || 'assets/splash_logo_b.png'}
                                        alt={meta?.label || mode}
                                        className="w-[65%] h-[65%] object-contain transition-all duration-300 opacity-100 group-hover:scale-[1.08] group-hover:-translate-y-[4px]"
                                    />
                                    {/* Project count badge */}
                                    <span className="absolute top-4 right-4 text-[11px] font-bold py-1.5 px-3 rounded-full tracking-[0.02em] uppercase z-[2] shadow-sm bg-white" style={{ color: meta?.darkAccent || '#4f46e5' }}>
                                        {modeProjects.length} {modeProjects.length === 1 ? 'project' : 'projects'}
                                    </span>
                                </div>

                                {/* Bottom dark gradient overlay */}
                                <div className="absolute inset-x-0 bottom-0 h-[60%] bg-gradient-to-t from-[#1e293b]/90 via-[#1e293b]/45 to-transparent z-[1] pointer-events-none" />

                                {/* Bottom text area */}
                                <div className="flex flex-col justify-end z-[2] w-full px-9 pb-8 pt-4">
                                    <h3 className="text-[22px] font-extrabold text-white mb-1.5 tracking-[-0.01em] drop-shadow-sm">{meta?.label || mode}</h3>
                                    <p className="text-[12px] font-bold text-slate-300 m-0 uppercase tracking-[0.06em] transition-all duration-300 group-hover:text-white">Open Workspace</p>
                                </div>

                                {/* Arrow button */}
                                <div
                                    className="absolute bottom-6 right-6 w-10 h-10 flex items-center justify-center rounded-full transition-all duration-300 z-[2] group-hover:scale-110 shadow-sm bg-white border border-[#e2e8f0]/40 group-hover:!bg-[var(--accent-color)] group-hover:!border-[var(--accent-color)]"
                                    style={{
                                        borderColor: meta?.accent || '#6366f1',
                                        '--accent-color': meta?.accent || '#6366f1',
                                    } as React.CSSProperties}
                                >
                                    <ChevronRight
                                        size={20}
                                        className="transition-colors group-hover:!text-white"
                                        style={{ color: meta?.darkAccent || '#4f46e5' }}
                                    />
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Clean design credits footer */}
                <div className="flex justify-center w-full mt-12">
                    <div className="flex items-center justify-center gap-4 py-4 px-6 text-[12px] font-semibold text-[#94a3b8] tracking-[0.02em] bg-white/60 backdrop-blur-[10px] border border-[rgba(226,232,240,0.5)] rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.03)] w-fit">
                        <span>LeapLab v1.1.0-STABLE</span>
                        <span className="w-1 h-1 bg-[#cbd5e1] rounded-full" />
                        <span>© 2026 Creoleap Technologies Pvt. Ltd. All rights reserved.</span>
                    </div>
                </div>
            </div>
        );
    }

    // Selected module project list view
    const meta = MODULES[selectedMode];
    const modeProjects = groupedProjects[selectedMode] || [];
    const filteredProjects = modeProjects.filter((p) =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div
            ref={containerRef}
            className="w-full max-w-full mx-auto box-border overflow-x-hidden animate-[fadeIn_0.5s_ease-out] page-projects-view"
            style={{
                '--module-accent': meta?.accent || '#6366f1',
                '--module-gradient': meta?.gradient || '#ffffff',
                '--module-dark-accent': meta?.darkAccent || '#4f46e5',
                padding: '40px 48px'
            } as React.CSSProperties}
        >
            {/* Back Button */}
            <div className="animate-[fadeIn_0.4s_ease-out] mb-6">
                <button
                    className="group inline-flex items-center gap-2 py-2.5 px-4.5 rounded-xl text-xs font-semibold text-slate-600 bg-white/70 backdrop-blur-md border border-slate-200/60 shadow-[0_1px_4px_rgba(0,0,0,0.03)] cursor-pointer transition-all duration-300 hover:-translate-y-0.5 active:scale-95"
                    onClick={() => {
                        setSelectedMode(null);
                        sessionStorage.removeItem('myProjectsSelectedMode');
                        setSearchQuery('');
                        useCloudProjectStore.getState().clearActiveProjectId();
                    }}
                    aria-label="Back to modules"
                    title="Back to modules"
                >
                    <ArrowLeft size={15} strokeWidth={2.2} className="transition-transform duration-300 group-hover:-translate-x-1" />
                    <span>Back to modules</span>
                </button>
            </div>

            {/* Workspace Header */}
            <div className="relative flex items-center justify-between gap-6 rounded-[24px] overflow-hidden p-7 lg:px-9 bg-white/72 backdrop-blur-2xl border border-white/85 shadow-[0_4px_32px_rgba(0,0,0,0.04),0_1px_4px_rgba(0,0,0,0.02)] mb-9">
                {renderHeaderBackgroundVisual(selectedMode)}

                <div className="flex items-center gap-5 relative z-[2]">
                    {/* Icon container with subtle glow */}
                    <div 
                        className="flex items-center justify-center shrink-0 transition-transform duration-500 hover:scale-105 w-14 h-14 rounded-2xl border shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
                        style={{
                            background: `linear-gradient(145deg, ${meta?.accent}10, ${meta?.accent}1A)`,
                            borderColor: `${meta?.accent}20`,
                            boxShadow: `0 4px 16px ${meta?.accent}10, 0 1px 3px rgba(0,0,0,0.04)`
                        }}
                    >
                        <img
                            src={meta?.icon || 'assets/splash_logo_b.png'}
                            alt={meta?.label || selectedMode}
                            className="w-[34px] h-[34px] object-contain"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <h2 className="m-0 text-xl font-bold text-slate-900 tracking-tight leading-snug">
                            {meta?.label || selectedMode} Workspace
                        </h2>
                        <div className="flex items-center gap-2">
                            <span 
                                className="inline-flex items-center gap-1.25 text-[11px] font-semibold py-1 px-2.5 rounded-lg"
                                style={{
                                    color: meta?.darkAccent || '#4f46e5',
                                    backgroundColor: `${meta?.accent}0C`,
                                    border: `1px solid ${meta?.accent}15`
                                }}
                            >
                                <span className="w-1.25 h-1.25 rounded-full" style={{ backgroundColor: meta?.accent }} />
                                {modeProjects.length} {modeProjects.length === 1 ? 'project' : 'projects'}
                            </span>
                            <span className="inline-flex items-center gap-1.25 text-[9.5px] font-bold py-1 px-2.5 rounded-lg uppercase tracking-wider text-green-600 bg-green-600/[0.06] border border-green-600/10">
                                <span className="w-1.25 h-1.25 rounded-full bg-green-600 animate-[pulse_2s_ease-in-out_infinite]" />
                                Live System
                            </span>
                        </div>
                    </div>
                </div>

                {/* Search Bar */}
                {modeProjects.length > 0 && (
                    <div className="shrink-0 w-full max-w-[280px] relative z-[2]">
                        <div className="relative flex items-center w-full transition-all duration-300 focus-within:shadow-[0_0_0_3px_rgba(99,102,241,0.06)] py-2.5 px-3.5 bg-white/85 backdrop-blur-md border border-slate-200/60 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
                            <Search size={16} className="shrink-0 text-slate-400 mr-2.5" />
                            <input
                                type="text"
                                placeholder={`Search ${meta?.label || selectedMode} projects...`}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="flex-1 border-none bg-transparent p-0 !outline-none !shadow-none placeholder:text-slate-400 text-xs font-medium text-slate-900"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="flex items-center justify-center cursor-pointer transition-all duration-200 bg-slate-100 hover:bg-slate-200 text-slate-500 w-6 h-6 rounded-lg border-none ml-2"
                                    aria-label="Clear search"
                                >
                                    <X size={13} />
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Content Area */}
            {modeProjects.length === 0 ? (
                <div className="flex justify-center w-full my-16 animate-[fadeIn_0.4s_ease-out]">
                    <div 
                        className="empty-state-card relative overflow-hidden flex flex-col items-center justify-center px-10 py-14 md:px-14 md:py-16 bg-white rounded-[2rem] border border-slate-200/40 w-full max-w-[520px] text-center shadow-sm"
                        style={{
                            background: `radial-gradient(ellipse 60% 50% at 50% 0%, ${meta?.accent || '#6366f1'}06 0%, #ffffff 70%)`
                        }}
                    >
                        {/* Subtle dot-grid pattern overlay */}
                        <div className="absolute inset-0 pointer-events-none opacity-[0.35]" style={{
                            backgroundImage: `radial-gradient(${meta?.accent || '#6366f1'}18 1px, transparent 1px)`,
                            backgroundSize: '20px 20px'
                        }} />

                        {/* Icon area with layered design */}
                        <div className="relative mb-10 flex items-center justify-center w-[120px] h-[120px]">
                            {/* Outer concentric pulse ring */}
                            <div className="empty-state-pulse-ring absolute rounded-full w-[110px] h-[110px]" style={{
                                border: `1.5px dashed ${meta?.accent || '#6366f1'}20`
                            }} />
                            
                            {/* Soft radial glow behind icon */}
                            <div className="absolute rounded-full opacity-50 blur-xl w-[100px] h-[100px]" style={{
                                background: `radial-gradient(circle, ${meta?.accent || '#6366f1'}18 0%, transparent 70%)`
                            }} />

                            {/* Floating decorative particles */}
                            <div className="empty-state-float-1 absolute w-2.5 h-2.5 rounded-full -top-1 left-2" style={{
                                backgroundColor: `${meta?.accent || '#6366f1'}25`
                            }} />
                            <div className="empty-state-float-2 absolute w-1.5 h-1.5 rounded-full top-5 -right-2" style={{
                                backgroundColor: `${meta?.accent || '#6366f1'}35`
                            }} />
                            <div className="empty-state-float-3 absolute font-bold text-sm bottom-1.5 right-1" style={{
                                color: `${meta?.accent || '#6366f1'}40`
                            }}>+</div>
                            <div className="empty-state-float-4 absolute w-2 h-2 rounded-full bottom-0.5 left-0.5" style={{
                                backgroundColor: `${meta?.accent || '#6366f1'}20`
                            }} />

                            {/* Main icon container - rounded square with inner circle */}
                            <div className="empty-state-icon-box relative w-20 h-20 rounded-2xl flex items-center justify-center border" style={{
                                background: `linear-gradient(135deg, ${meta?.accent || '#6366f1'}10 0%, ${meta?.accent || '#6366f1'}18 100%)`,
                                borderColor: `${meta?.accent || '#6366f1'}15`,
                                boxShadow: `0 8px 24px -6px ${(meta?.accent || '#6366f1')}20`
                            }}>
                                {/* Inner white circle for icon */}
                                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm">
                                    <FolderOpen size={24} style={{ color: meta?.accent || '#6366f1' }} />
                                </div>
                            </div>
                        </div>

                        {/* Content */}
                        <div className="relative z-[1] flex flex-col items-center">
                            <h3 className="text-[22px] md:text-[24px] font-bold text-slate-800 tracking-[-0.02em] m-0 mb-3">
                                No projects saved yet
                            </h3>
                            <p className="text-[14px] text-slate-500 max-w-[340px] m-0 leading-relaxed mb-10">
                                Start creating awesome projects in{' '}
                                <span 
                                    className="inline-flex items-center px-2.5 py-0.5 mx-1 rounded-full text-[12px] font-semibold border"
                                    style={{ 
                                        background: `${meta?.accent || '#6366f1'}08`, 
                                        borderColor: `${meta?.accent || '#6366f1'}18`,
                                        color: meta?.darkAccent || meta?.accent || '#4f46e5'
                                    }}
                                >
                                    {meta?.label}
                                </span>{' '}
                                and they&apos;ll show up right here!
                            </p>
                            
                            <button
                                className="group inline-flex items-center gap-2.5 py-3 px-7 rounded-xl text-white font-semibold text-sm cursor-pointer transition-all duration-300 hover:-translate-y-0.5 active:scale-95 shadow-md"
                                style={{
                                    background: `linear-gradient(135deg, ${meta?.accent || '#6366f1'}, ${meta?.darkAccent || '#4f46e5'})`
                                }}
                                onClick={() => {
                                    setSelectedMode(null);
                                    sessionStorage.removeItem('myProjectsSelectedMode');
                                }}
                            >
                                <ArrowLeft size={16} className="transition-transform duration-300 group-hover:-translate-x-1" />
                                Back to modules
                            </button>
                        </div>
                    </div>
                </div>
            ) : filteredProjects.length === 0 ? (
                <div className="flex justify-center w-full py-16 px-4 animate-[fadeIn_0.5s_ease-out]">
                    <div className="relative flex flex-col items-center justify-center w-full max-w-[520px] text-center rounded-[28px] overflow-hidden pt-14 px-12 pb-12 bg-white/72 backdrop-blur-xl border border-white/80 shadow-[0_4px_32px_rgba(0,0,0,0.04),0_1px_4px_rgba(0,0,0,0.02)]">
                        {/* Subtle decorative gradient blob */}
                        <div 
                            className="absolute -top-10 left-1/2 -translate-x-1/2 w-[280px] h-[180px] rounded-full pointer-events-none blur-3xl"
                            style={{
                                background: `radial-gradient(ellipse at center, ${meta?.accent || '#22C55E'}0D 0%, transparent 70%)`
                            }}
                        />

                        {/* Icon with pulse ring */}
                        <div className="relative mb-8 flex items-center justify-center">
                            {/* Outer pulse ring */}
                            <div className="absolute w-[88px] h-[88px] rounded-full animate-[ping_2.5s_cubic-bezier(0,0,0.2,1)_infinite]" style={{ border: `1.5px solid ${meta?.accent || '#22C55E'}15` }} />
                            {/* Background circle */}
                            <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center" style={{ background: `linear-gradient(145deg, ${meta?.accent || '#22C55E'}0A, ${meta?.accent || '#22C55E'}14)`, border: `1.5px solid ${meta?.accent || '#22C55E'}20` }}>
                                {/* Inner ring with icon */}
                                <div className="w-[44px] h-[44px] rounded-full flex items-center justify-center bg-white/80 border-2" style={{ borderColor: meta?.accent || '#22C55E' }}>
                                    <Search size={20} strokeWidth={2.5} style={{ color: meta?.accent || '#22C55E' }} />
                                </div>
                            </div>
                        </div>

                        {/* Heading */}
                        <h3 className="m-0 mb-3 text-6xl md:text-[22px] font-extrabold text-slate-900 tracking-tight leading-snug">
                            No matching projects
                        </h3>
                        
                        {/* Description */}
                        <p className="m-0 mb-8 text-sm text-slate-500 leading-relaxed max-w-[380px]">
                            We couldn&apos;t find anything matching{' '}
                            <span className="inline-flex items-center align-middle max-w-[140px] truncate py-0.5 px-2.5 mx-0.75 rounded-md text-[12.5px] font-bold font-mono" style={{ background: `${meta?.accent || '#22C55E'}0C`, border: `1px solid ${meta?.accent || '#22C55E'}20`, color: meta?.darkAccent || meta?.accent || '#15803D' }} title={searchQuery}>
                                {searchQuery}
                            </span>
                            . Try different keywords or browse our popular categories below.
                        </p>
                        
                        {/* Divider */}
                        <div className="w-full mb-7 h-px bg-gradient-to-r from-transparent via-black/[0.06] to-transparent" />

                        {/* Action buttons */}
                        <div className="flex items-center gap-3 flex-wrap justify-center">
                            <button
                                className="group inline-flex items-center gap-2 cursor-pointer transition-all duration-300 hover:-translate-y-0.5 active:scale-95 py-2.5 px-6 rounded-2xl text-[13.5px] font-semibold text-white border-none shadow-md"
                                style={{ background: `linear-gradient(135deg, ${meta?.accent || '#22C55E'}, ${meta?.darkAccent || '#15803D'})` }}
                                onClick={() => setSearchQuery('')}
                            >
                                <X size={15} strokeWidth={2.5} className="transition-transform duration-300 group-hover:rotate-90" />
                                Clear Search
                            </button>
                            <button
                                className="group inline-flex items-center gap-2 cursor-pointer transition-all duration-300 hover:-translate-y-0.5 active:scale-95 py-2.5 px-6 rounded-2xl text-[13.5px] font-semibold bg-white/90 shadow-sm"
                                style={{ border: `1.5px solid ${meta?.accent || '#22C55E'}20`, color: meta?.darkAccent || meta?.accent || '#15803D' }}
                                onClick={() => {
                                    setSelectedMode(null);
                                    sessionStorage.removeItem('myProjectsSelectedMode');
                                    setSearchQuery('');
                                }}
                            >
                                <Compass size={15} strokeWidth={2.5} />
                                Explore All
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] justify-center gap-6 pb-8 w-full pt-10" ref={scrollRef}>
                    {filteredProjects.map((project) => (
                        <div
                            key={project.id}
                            className="premium-project-card group relative w-full h-[285px] bg-white rounded-2xl overflow-hidden cursor-pointer flex flex-col shadow-[0_4px_20px_rgba(0,0,0,0.02),0_1px_3px_rgba(0,0,0,0.02)] border border-slate-200/70"
                            onClick={() => handleOpenProject(project)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleOpenProject(project);
                                }
                            }}
                        >
                            {/* Top accent bar */}
                            <div className="premium-card-accent-bar absolute top-0 left-0 w-full h-[3px] z-[3]" style={{
                                background: `linear-gradient(90deg, ${meta?.accent || '#6366f1'}, ${meta?.darkAccent || '#4f46e5'})`
                            }} />

                            {/* Top Visual Section */}
                            <div className="premium-card-visual-container relative w-full h-[140px] flex items-center justify-center overflow-hidden border-b border-[#e2e8f0]/50 bg-[#fafbfe]">
                                {project.thumbnailUrl ? (
                                    <img
                                        src={project.thumbnailUrl.startsWith('http')
                                            ? project.thumbnailUrl
                                            : `${LMS_API_BASE}${project.thumbnailUrl}`}
                                        alt={project.name}
                                        className="w-full h-full object-cover transition-all duration-500 group-hover:scale-[1.04]"
                                    />
                                ) : (
                                    <SavedProjectCardVisual projectId={project.id} fileUrl={project.fileUrl} mode={project.mode || selectedMode} projectName={project.name} accent={meta?.accent || '#6366F1'} />
                                )}
                            </div>

                            {/* Bottom Details Section */}
                            <div className="flex flex-col justify-between flex-1 bg-gradient-to-b from-white to-slate-50/50 p-4 px-5">
                                {/* Title and Board Badge */}
                                <div className="flex items-start justify-between gap-2.5">
                                    <h4 className="text-[13px] font-extrabold text-slate-800 line-clamp-2 leading-[1.4] m-0 transition-colors duration-200 group-hover:text-[var(--module-dark-accent)] font-sans">
                                        {highlightMatch(project.name, searchQuery)}
                                    </h4>
                                    <ProjectBoardBadge project={project} />
                                </div>

                                {/* Date and Action Buttons */}
                                <div className="flex items-center justify-between mt-auto">
                                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400/80 tracking-wide uppercase">
                                        <Calendar size={12} className="opacity-70 text-slate-400" />
                                        <span>{formatDate(project.updatedAt)}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            className="premium-button-action cursor-pointer w-8 h-8 rounded-lg flex items-center justify-center border shadow-sm transition-all duration-200"
                                            style={{
                                                background: project.isShared === 1 ? 'rgba(37,99,235,0.08)' : 'rgba(99,102,241,0.04)',
                                                borderColor: project.isShared === 1 ? 'rgba(37,99,235,0.25)' : 'rgba(99,102,241,0.15)',
                                                color: project.isShared === 1 ? '#2563eb' : 'var(--module-dark-accent)'
                                            }}
                                            onClick={(e) => { e.stopPropagation(); handleShareProject(e, project); }}
                                            title={project.isShared === 1 ? 'Manage sharing' : 'Share project'}
                                        >
                                            <Share2 size={13} />
                                        </button>
                                        <button
                                            className="premium-button-action cursor-pointer w-8 h-8 rounded-lg flex items-center justify-center border text-[#f43f5e] shadow-sm transition-all duration-200"
                                            style={{
                                                background: 'rgba(244,63,94,0.03)',
                                                borderColor: 'rgba(244,63,94,0.15)'
                                            }}
                                            onClick={(e) => { e.stopPropagation(); handleDeleteProject(e, project); }}
                                            disabled={deletingId === project.id}
                                            title="Delete project"
                                        >
                                            {deletingId === project.id ? (
                                                <span className="inline-block w-3 h-3 border-2 border-[rgba(244,63,94,0.2)] border-t-[#f43f5e] rounded-full animate-[spin_0.6s_linear_infinite]" />
                                            ) : (
                                                <Trash2 size={13} />
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Loading Overlay */}
                            {openingId === project.id && (
                                <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center gap-3 text-white text-xs font-semibold z-[5] animate-[fadeIn_0.25s_ease-out]">
                                    <div className="w-6 h-6 border-[3px] border-white/10 border-t-indigo-500 rounded-full animate-[spin_0.6s_linear_infinite]" />
                                    <span>Opening Workspace...</span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Footer */}
            <div className="flex justify-center w-full mt-12">
                <div className="flex items-center justify-center gap-5 py-4 px-8 text-[12px] font-medium text-[#94a3b8] bg-white/50 backdrop-blur-xl border border-[#e2e8f0]/60 rounded-2xl shadow-sm w-fit">
                    <span className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-md bg-gradient-to-br from-[#4f46e5] to-[#6366f1] flex items-center justify-center text-white text-[9px] font-bold">L</span>
                        LeapLab v1.1.0-STABLE
                    </span>
                    <span className="w-px h-4 bg-[#e2e8f0]" />
                    <span>&copy; 2026 Creoleap Technologies Pvt. Ltd.</span>
                </div>
            </div>

            {sharingProject && (
                <ShareProjectModal
                    project={sharingProject}
                    onClose={() => setSharingProject(null)}
                    onUpdate={handleShareUpdate}
                />
            )}

            {projectToDelete && (
                <DeleteConfirmationModal
                    projectName={projectToDelete.name}
                    onConfirm={confirmDeleteProject}
                    onCancel={() => setProjectToDelete(null)}
                />
            )}
        </div>
    );
}
