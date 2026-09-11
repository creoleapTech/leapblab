/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */

declare global {
    interface Window {
        webkitAudioContext?: typeof AudioContext;
    }
}

export interface AudioRecordResult {
    blob: Blob;
    buffer: AudioBuffer;
    blobUrl: string;
}

export type OnCompleteCallback = (result: AudioRecordResult) => void;

export default class AudioRecorder {
    public audioContext: AudioContext;
    public analyserNode: AnalyserNode;
    public mediaStream: MediaStream | null;
    public mediaStreamSource: MediaStreamAudioSourceNode | null;
    public mediaRecorder: MediaRecorder | null;
    public audioChunks: Blob[];
    public isRecording: boolean;
    public onComplete: OnCompleteCallback | null;

    constructor() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext!;
        this.audioContext = new AudioContextClass();
        this.analyserNode = this.audioContext.createAnalyser();

        // Settings analogous to leap
        this.analyserNode.fftSize = 256;

        this.mediaStream = null;
        this.mediaStreamSource = null;
        this.mediaRecorder = null;
        this.audioChunks = [];

        // State
        this.isRecording = false;
        this.onComplete = null;
    }

    /**
     * Request microphone permissions and initialize the stream.
     */
    async requestDevice(): Promise<boolean> {
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Connect stream to analyser for visualizer
            this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.mediaStreamSource.connect(this.analyserNode);

            return true;
        } catch (error) {
            console.error('Microphone access denied or error:', error);
            return false;
        }
    }

    /**
     * Returns the analyser node for the level meter.
     */
    getAnalyser(): AnalyserNode {
        return this.analyserNode;
    }

    /**
     * Starts recording audio chunks.
     */
    start(): void {
        if (!this.mediaStream) {
            throw new Error('MediaStream not initialized. Call requestDevice() first.');
        }

        this.audioChunks = [];
        this.mediaRecorder = new MediaRecorder(this.mediaStream);

        this.mediaRecorder.ondataavailable = (e: BlobEvent) => {
            if (e.data.size > 0) {
                this.audioChunks.push(e.data);
            }
        };

        this.mediaRecorder.onstop = () => this._onStop();

        this.mediaRecorder.start(100); // Capture chunks every 100ms
        this.isRecording = true;
    }

    /**
     * Stops the recording process.
     */
    stop(): void {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;
        }
    }

    /**
     * Internal handler when the MediaRecorder fully stops.
     */
    async _onStop(): Promise<void> {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' }); // Browsers often record webm or ogg

        // Convert Blob into an AudioBuffer using AudioContext
        try {
            const arrayBuffer = await audioBlob.arrayBuffer();
            const decodedBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            if (this.onComplete) {
                this.onComplete({
                    blob: audioBlob,
                    buffer: decodedBuffer,
                    blobUrl: URL.createObjectURL(audioBlob)
                });
            }
        } catch (error) {
            console.error("Error decoding recorded audio:", error);
        }
    }

    /**
     * Cleanly dispose of the microphone track and nodes.
     */
    dispose(): void {
        this.stop();
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
        }
        if (this.mediaStreamSource) {
            this.mediaStreamSource.disconnect();
        }
        this.mediaStream = null;
        this.mediaRecorder = null;
    }
}
