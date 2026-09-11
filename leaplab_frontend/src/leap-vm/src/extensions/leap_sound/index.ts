/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */

export interface PlaySoundArgs {
    SOUND_MENU?: string;
    SOUND?: string;
    [key: string]: any;
}

export interface SoundBlockUtil {
    target?: {
        id?: string;
        [key: string]: any;
    };
    [key: string]: any;
}

export interface SoundRuntime {
    audioEngine?: {
        playSound?: (soundName?: string, targetId?: string) => Promise<any> | any;
        stopAllSounds?: () => void;
        [key: string]: any;
    };
    [key: string]: any;
}

export class leap3SoundBlocks {
    public runtime: SoundRuntime;

    constructor(runtime: SoundRuntime) {
        this.runtime = runtime;
    }

    /**
     * Play a sound and wait for it to finish, or just play it.
     * In leap, this usually takes a SOUND_MENU arg.
     */
    playSound(args: PlaySoundArgs = {}, util?: SoundBlockUtil): any {
        const soundName = args.SOUND_MENU || args.SOUND;
        const targetId = util?.target?.id || "global";

        return this.runtime?.audioEngine?.playSound?.(soundName, targetId);
    }

    /**
     * Stop all sounds on the global audio engine.
     */
    stopAllSounds(_args?: any, _util?: SoundBlockUtil): void {
        this.runtime?.audioEngine?.stopAllSounds?.();
    }

    // Advanced block placeholders (pitch/volume)
    changeEffectBy(_args?: any, _util?: SoundBlockUtil): void {
        // e.g. change pitch by 10
        // this requires target tracking in the VM which we can stub or ignore for now
    }

    setEffectTo(_args?: any, _util?: SoundBlockUtil): void {
        // e.g. set volume to 50%
    }
}
