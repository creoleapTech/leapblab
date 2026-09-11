/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React from 'react';

const RecordButton = ({ isRecording, onClick }) => {
    return (
        <div className="flex justify-center w-full mt-[10px]">
            <button
                className="w-[60px] h-[60px] rounded-full border-[3px] border-[#ff4d4d] bg-white flex items-center justify-center cursor-pointer transition-all duration-200 outline-none hover:scale-[1.05]"
                onClick={onClick}
                title={isRecording ? "Stop Recording" : "Record Sound"}
            >
                <div className={`w-6 h-6 bg-[#ff4d4d] transition-all duration-200 ${isRecording ? 'rounded-[4px]' : 'rounded-full'}`}></div>
            </button>
        </div>
    );
};

export default RecordButton;
