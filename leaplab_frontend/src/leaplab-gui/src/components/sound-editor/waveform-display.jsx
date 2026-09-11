/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React, { useEffect, useRef } from 'react';

const WaveformDisplay = ({ buffer }) => {
    const canvasRef = useRef(null);

    useEffect(() => {
        if (!buffer) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);

        // Draw background
        ctx.fillStyle = '#dbf2ec'; // Light green leap background
        ctx.fillRect(0, 0, width, height);

        const data = buffer.getChannelData(0); // Use mono channel 0 for display
        const step = Math.ceil(data.length / width);
        const amp = height / 2;

        ctx.fillStyle = '#0fbd8c'; // LeapBlocks Green

        for (let i = 0; i < width; i++) {
            let min = 1.0;
            let max = -1.0;
            for (let j = 0; j < step; j++) {
                const datum = data[(i * step) + j];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }

            // Draw a single vertical line from min to max amplitude in this chunk
            const yMin = (1 + min) * amp;
            const yMax = (1 + max) * amp;

            ctx.fillRect(i, yMin, 1, Math.max(1, yMax - yMin));
        }

    }, [buffer]);

    if (!buffer) return null;

    return (
        <div className="waveform-display">
            <canvas ref={canvasRef} width={600} height={150} style={{ width: '100%', height: '150px', borderRadius: '8px' }} />
        </div>
    );
};

export default WaveformDisplay;
