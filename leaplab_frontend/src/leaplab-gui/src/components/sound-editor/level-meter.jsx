/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React, { useEffect, useRef } from 'react';

const LevelMeter = ({ analyser }) => {
    const canvasRef = useRef(null);
    const requestRef = useRef();

    useEffect(() => {
        if (!analyser) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        // Adjust canvas dimensions for retina displays
        const width = canvas.width;
        const height = canvas.height;

        const renderFrame = () => {
            requestRef.current = requestAnimationFrame(renderFrame);

            analyser.getByteFrequencyData(dataArray);

            ctx.clearRect(0, 0, width, height);

            // Draw leap-style level meter (simple volume representation via frequency average)
            // A more complex one would draw multiple bars, we'll draw a large visualizer

            ctx.fillStyle = '#dbf2ec'; // light green bg
            ctx.fillRect(0, 0, width, height);

            const barWidth = (width / bufferLength) * 2.5;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * height;

                ctx.fillStyle = '#0fbd8c'; // LeapBlocks/leap Green
                ctx.fillRect(x, height - barHeight, barWidth, barHeight);

                x += barWidth + 1;
            }
        };

        renderFrame();

        return () => {
            cancelAnimationFrame(requestRef.current);
        };
    }, [analyser]);

    return (
        <div className="level-meter">
            <canvas ref={canvasRef} width={300} height={100} style={{ width: '100%', height: '100px', borderRadius: '8px' }} />
        </div>
    );
};

export default LevelMeter;
