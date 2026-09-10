/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React from "react";
import { Plus, Trash2 } from "lucide-react";
import StageCanvas from "../stage/StageCanvas";
import SpriteProperties from "../stage/SpriteProperties";

const C = {
    PURPLE: "#8B5CF6",
    LIGHT_PURPLE: "#EDE9FE",
    BORDER: "#E5E7EB",
    TEXT: "#1F2937",
    MUTED: "#6B7280",
};

const getFileBaseName = (fileName = "") => fileName.replace(/\.[^/.]+$/, "").toLowerCase();

const getActiveMode = (activeFile, sprites) => {
    const baseName = getFileBaseName(activeFile);
    if (!baseName) return "mixed";
    if (baseName === "stage") return "stage";

    const matchesSpriteFile = sprites.some((sprite) => sprite?.name?.toLowerCase() === baseName);
    if (matchesSpriteFile || baseName.includes("robot") || baseName.includes("tobi")) {
        return "sprite";
    }

    return "mixed";
};

const getSpritePreview = (sprite) => {
    const costumes = sprite?.costumes || {};
    return costumes[sprite?.currentCostume] || costumes.default || sprite?.img || null;
};

const isImageSource = (value) =>
    typeof value === "string" &&
    (value.includes("/") ||
        value.startsWith("data:image") ||
        /\.(png|jpe?g|svg|gif|webp)$/i.test(value));

const getSpriteFallback = (spriteType) => {
    if (spriteType === "robot") {
        return (
            <img
                src="assets/sprites/robot/robot_idle.svg"
                alt="Robot"
                className="w-12 h-12"
            />
        );
    }

    if (spriteType === "cat") return "\u{1F431}";
    if (spriteType === "ball") return "\u26BD";
    return "\u{1F3AD}";
};

function ActionButton({ label, onClick }) {
    return (
        <button
            onClick={onClick}
            className="flex items-center gap-1.5 px-2.5 py-1.5 border-none rounded-md bg-purple-600 text-white text-[11px] font-bold cursor-pointer hover:bg-purple-700 transition-colors"
        >
            <Plus size={12} />
            {label}
        </button>
    );
}

export default function StagePanel({
    activeFile,
    sprites,
    selectedSpriteId,
    setSelectedSpriteId,
    backdrop,
    stageRef,
    stageSize,
    onOpenAssetLibrary,
    updateSpriteProperty,
    BACKDROP_LIBRARY,
    handleSetBackdrop,
    deleteSprite,
    className,
    style,
}) {
    const spriteList = Array.isArray(sprites) ? sprites : [];
    const backdropLibrary = Array.isArray(BACKDROP_LIBRARY) ? BACKDROP_LIBRARY : [];
    const activeMode = getActiveMode(activeFile, spriteList);
    const activeFileBaseName = getFileBaseName(activeFile);
    const fileSprite = spriteList.find((sprite) => sprite?.name?.toLowerCase() === activeFileBaseName) || null;
    const selectedSprite =
        (activeMode === "sprite" ? fileSprite : null) ||
        spriteList.find((sprite) => sprite.id === selectedSpriteId) ||
        spriteList[0] ||
        null;
    const costumeEntries = Object.entries(selectedSprite?.costumes || {});
    const showSpritesPanel = true; // Always allow showing sprites/costumes panel
    const showBackdropsPanel = activeMode !== "sprite";

    const [showSprites, setShowSprites] = React.useState(true);
    const [showBackdrops, setShowBackdrops] = React.useState(true);

    return (
        <div style={style} className={className || "w-[380px] flex flex-col border-l border-gray-200 bg-white shrink-0 min-h-0 overflow-y-auto"}>
            <div className="p-3 border-b border-gray-200">
                <div className="text-xs font-bold text-gray-500 mb-2 tracking-wider uppercase">
                    Stage
                </div>
                <div className="w-full h-[240px] border border-gray-200 rounded-xl overflow-hidden bg-[#f5f5f5]">
                    <StageCanvas
                        sprites={spriteList}
                        selectedSpriteId={selectedSpriteId}
                        setSelectedSpriteId={setSelectedSpriteId}
                        backdrop={backdrop}
                        stageRef={stageRef}
                        stageSize={stageSize || { w: 356, h: 240 }}
                        updateSpriteProperty={updateSpriteProperty}
                    />
                </div>
            </div>

            {activeMode !== "stage" && (
                <SpriteProperties
                    selectedSprite={selectedSprite}
                    selectedSpriteId={selectedSprite?.id || selectedSpriteId}
                    updateSpriteProperty={updateSpriteProperty}
                />
            )}

            <div className="border-t border-gray-200 p-3 flex flex-col gap-2">
                <div
                    className={`flex items-center justify-between ${showSpritesPanel ? 'cursor-pointer' : 'cursor-default'}`}
                    onClick={() => showSpritesPanel && setShowSprites((prev) => !prev)}
                >
                    <span className="text-xs font-bold text-gray-500 tracking-wider uppercase">
                        {activeMode === "sprite" ? "Costumes" : "Sprites"}
                    </span>
                    <span className="text-[11px] text-gray-500">
                        {showSprites ? "\u25BC" : "\u25B6"}
                    </span>
                </div>

                {showSprites && (
                    <>
                            <div className="flex justify-end">
                                <ActionButton
                                    label={activeMode === "sprite" ? "Add Costume" : "Add Sprite"}
                                    onClick={() =>
                                        onOpenAssetLibrary?.(activeMode === "sprite" ? "costume" : "sprite")
                                    }
                                />
                            </div>

                            {activeMode === "sprite" ? (
                                selectedSprite ? (
                                    <div className="flex gap-2 overflow-x-auto pb-0.5">
                                        {costumeEntries.map(([costumeName, costumeValue]) => {
                                            const isSelected = costumeName === selectedSprite.currentCostume;

                                            return (
                                                <div
                                                    key={costumeName}
                                                    onClick={() =>
                                                        updateSpriteProperty?.(selectedSprite.id, "currentCostume", costumeName)
                                                    }
                                                    className={`min-w-[92px] p-2 rounded-xl border-2 cursor-pointer flex flex-col items-center gap-1.5 ${
                                                        isSelected ? 'border-purple-600 bg-purple-100' : 'border-gray-200 bg-gray-50'
                                                    }`}
                                                >
                                                    <div className={`w-14 h-14 rounded-lg bg-white flex items-center justify-center overflow-hidden ${
                                                        isSelected ? 'border-2 border-purple-600' : 'border border-gray-200'
                                                    }`}>
                                                        {isImageSource(costumeValue) ? (
                                                            <img
                                                                src={costumeValue}
                                                                alt={costumeName}
                                                                className="w-[90%] h-[90%] object-contain"
                                                            />
                                                        ) : (
                                                            <span className="text-3xl">{costumeValue || "?"}</span>
                                                        )}
                                                    </div>
                                                    <div className={`text-[11px] font-bold text-center max-w-[76px] overflow-hidden text-ellipsis whitespace-nowrap ${
                                                        isSelected ? 'text-purple-600' : 'text-gray-800'
                                                    }`}>
                                                        {costumeName}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-xs text-gray-500 py-1.5">
                                        No sprite is linked to {activeFile || "this file"} yet.
                                    </div>
                                )
                            ) : (
                                <div className="flex gap-2 overflow-x-auto pb-0.5">
                                    {spriteList.map((sprite) => {
                                        const preview = getSpritePreview(sprite);
                                        const isSelected = sprite.id === selectedSpriteId;

                                        return (
                                            <div
                                                key={sprite.id}
                                                onClick={() => setSelectedSpriteId(sprite.id)}
                                                className={`min-w-[86px] p-2 rounded-xl border-2 cursor-pointer flex flex-col items-center gap-1.5 relative ${
                                                    isSelected ? 'border-purple-600 bg-purple-100' : 'border-gray-200 bg-gray-50'
                                                }`}
                                            >
                                                {spriteList.length > 1 && isSelected && (
                                                    <button
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            deleteSprite?.(sprite.id);
                                                        }}
                                                        className="absolute -top-2 -right-2 w-5.5 h-5.5 rounded-full border-none bg-white shadow-md text-red-500 cursor-pointer flex items-center justify-center"
                                                        title={`Delete ${sprite.name}`}
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                )}

                                                <div className={`w-14 h-14 rounded-lg flex items-center justify-center overflow-hidden transition-all ${
                                                    isSelected ? 'bg-purple-100 border-2 border-purple-600 shadow-[0_0_0_2px_rgba(139,92,246,0.25)]' : 'bg-white border-2 border-transparent'
                                                }`}>
                                                    {preview && isImageSource(preview) ? (
                                                        <img
                                                            src={preview}
                                                            alt={sprite.name}
                                                            className="w-[90%] h-[90%] object-contain"
                                                        />
                                                    ) : (
                                                        <span className="text-3xl">
                                                            {preview || getSpriteFallback(sprite.type)}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className={`text-[11px] font-bold text-center max-w-[70px] overflow-hidden text-ellipsis whitespace-nowrap ${
                                                    isSelected ? 'text-purple-600' : 'text-gray-800'
                                                }`}>
                                                    {sprite.name}
                                                </div>
                                                <div className="text-[9px] text-gray-500 font-mono">
                                                    x:{Math.round(sprite.position?.x ?? sprite.x ?? 0)} y:
                                                    {Math.round(sprite.position?.y ?? sprite.y ?? 0)}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    )}
            </div>

            <div className="border-t border-gray-200 p-3 flex flex-col gap-2 min-h-0">
                <div
                    onClick={() => showBackdropsPanel && setShowBackdrops((prev) => !prev)}
                    className={`flex items-center justify-between ${showBackdropsPanel ? 'cursor-pointer' : 'cursor-default'}`}
                >
                    <span className="text-xs font-bold text-gray-500 tracking-wider uppercase">
                        Backdrops
                    </span>
                    <span className="text-[11px] text-gray-500">
                        {showBackdropsPanel ? (showBackdrops ? "\u25BC" : "\u25B6") : "\u{1F6AB}"}
                    </span>
                </div>

                {showBackdropsPanel ? (
                    showBackdrops && (
                        <>
                            {activeMode === "stage" && (
                                <div className="flex justify-end">
                                    <ActionButton
                                        label="Add Backdrop"
                                        onClick={() => onOpenAssetLibrary?.("backdrop")}
                                    />
                                </div>
                            )}
                            <div className="flex gap-2 overflow-x-auto pb-0.5">
                                {backdropLibrary.map((backdropEntry) => {
                                    const image = backdropEntry.img || backdropEntry.image || null;
                                    const isSelected = backdrop === image;

                                    return (
                                        <div
                                            key={backdropEntry.id || backdropEntry.name}
                                            onClick={() => handleSetBackdrop(backdropEntry)}
                                            className={`min-w-[92px] p-2 rounded-xl border-2 cursor-pointer flex flex-col gap-1.5 ${
                                                isSelected ? 'border-purple-600 bg-purple-100' : 'border-gray-200 bg-gray-50'
                                            }`}
                                        >
                                            <div className="w-full h-14 rounded-lg overflow-hidden bg-white border border-gray-200 flex items-center justify-center">
                                                {image ? (
                                                    <img
                                                        src={image}
                                                        alt={backdropEntry.name}
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <span className="text-[11px] text-gray-500">Blank</span>
                                                )}
                                            </div>
                                            <div className="text-[11px] font-bold text-gray-800 text-center">
                                                {backdropEntry.name}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )
                ) : (
                    <div className="text-xs text-gray-500 py-1.5">
                        Sprite file selected. Switch to stage.py to edit backdrops.
                    </div>
                )}
            </div>
        </div>
    );
}
