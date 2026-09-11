/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React, { useState, useEffect, useRef } from 'react';
import AudioRecorder from '../../lib/audio/audio-recorder';
import RecordButton from './record-button';
import LevelMeter from './level-meter';
import WaveformDisplay from './waveform-display';

const SoundRecorder = ({ isOpen, onClose, onSave }) => {
    const [isRecording, setIsRecording] = useState(false);
    const [audioData, setAudioData] = useState(null); // { blob, buffer, blobUrl }
    const [analyser, setAnalyser] = useState(null);
    const recorderRef = useRef(null);

    // Initialize recorder engine when modal opens
    useEffect(() => {
        if (isOpen) {
            recorderRef.current = new AudioRecorder();
            recorderRef.current.onComplete = (data) => {
                setAudioData(data);
            };

            // Request mic access immediately or on first interaction (leap requests on open)
            recorderRef.current.requestDevice().then(success => {
                if (success) {
                    setAnalyser(recorderRef.current.getAnalyser());
                }
            });
        }

        return () => {
            if (recorderRef.current) {
                recorderRef.current.dispose();
                recorderRef.current = null;
            }
            setIsRecording(false);
            setAudioData(null);
            setAnalyser(null);
        };
    }, [isOpen]);

    const handleToggleRecording = () => {
        if (!recorderRef.current) return;

        if (isRecording) {
            recorderRef.current.stop();
            setIsRecording(false);
        } else {
            setAudioData(null); // Clear previous
            recorderRef.current.start();
            setIsRecording(true);
        }
    };

    const handleSave = () => {
        if (audioData && onSave) {
            onSave(audioData);
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 w-screen h-screen bg-black/40 flex items-center justify-center z-[10000]">
            <div className="bg-white w-[500px] rounded-lg shadow-[0_4px_15px_rgba(0,0,0,0.2)] flex flex-col overflow-hidden">
                <div className="bg-[#6200a9] text-white p-4 flex justify-between items-center font-bold text-[1.1rem]">
                    <span>Record Sound</span>
                    <button className="bg-transparent border-0 text-white text-[1.5rem] cursor-pointer leading-none" onClick={onClose} aria-label="Close">×</button>
                </div>

                <div className="p-6 flex flex-col items-center gap-[20px]">
                    {/* Visualizer Row */}
                    {!audioData && (
                        <div className="w-full">
                            <LevelMeter analyser={analyser} />
                        </div>
                    )}

                    {audioData && (
                        <div className="w-full">
                            <WaveformDisplay buffer={audioData.buffer} />
                        </div>
                    )}

                    {/* Controls Row */}
                    <RecordButton
                        isRecording={isRecording}
                        onClick={handleToggleRecording}
                    />

                    {isRecording ? (
                        <div style={{ color: '#ff4d4d', fontWeight: 'bold' }}>Recording...</div>
                    ) : (
                        <div style={{ color: '#666' }}>
                            {audioData ? 'Ready to save' : 'Click to record'}
                        </div>
                    )}
                </div>

                <div className="flex justify-end p-4 bg-[#f9f9f9] border-t border-[#eee] gap-[10px]">
                    <button className="bg-white border border-[#ccc] px-4 py-2 rounded cursor-pointer hover:bg-[#f0f0f0]" onClick={onClose}>Cancel</button>
                    <button
                        className="bg-[#0fbd8c] text-white border-0 px-4 py-2 rounded cursor-pointer font-bold disabled:bg-[#ccc] disabled:cursor-not-allowed"
                        onClick={handleSave}
                        disabled={!audioData || isRecording}
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SoundRecorder;
