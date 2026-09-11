/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */

export interface PlayNoteArgs {
    NOTE?: string;
    OCTAVE?: number;
    DURATION?: number;
}

export interface SetInstrumentArgs {
    INSTRUMENT?: string;
}

export interface PlayMusicArgs {
    MUSIC?: string;
}

export interface MusicRuntime {
    audioEngine?: {
        instrumentPlayer?: {
            playNoteForDuration?: (note: string, octave: number, duration: number) => void;
            setInstrument?: (instrumentName: string) => void;
        };
        soundBank?: {
            playMusic?: (musicName?: string) => void;
            stopMusic?: () => void;
        };
    };
    [key: string]: any;
}

export class leap3MusicBlocks {
    public runtime: MusicRuntime;

    constructor(runtime: MusicRuntime) {
        this.runtime = runtime;
    }

    /**
     * Play a specific note for a duration
     */
    playNoteForDuration(args: PlayNoteArgs = {}, _util?: any): void {
        const note = args.NOTE || "C";
        const octave = args.OCTAVE || 4;
        const duration = args.DURATION || 0.5;

        this.runtime?.audioEngine?.instrumentPlayer?.playNoteForDuration?.(note, octave, duration);
    }

    /**
     * Set the current instrument 
     */
    setInstrument(args: SetInstrumentArgs = {}, _util?: any): void {
        const instrumentName = args.INSTRUMENT || "piano";
        this.runtime?.audioEngine?.instrumentPlayer?.setInstrument?.(instrumentName);
    }

    /**
     * Play a looping background music track
     */
    playMusic(args: PlayMusicArgs = {}, _util?: any): void {
        const musicName = args.MUSIC;
        this.runtime?.audioEngine?.soundBank?.playMusic?.(musicName);
    }

    /**
     * Stop music playback
     */
    stopMusic(_args?: any, _util?: any): void {
        this.runtime?.audioEngine?.soundBank?.stopMusic?.();
    }
}
