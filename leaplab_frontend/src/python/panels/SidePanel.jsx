/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React from "react";
import {
    FileText,
    Package,
    Download,
    Search,
    Trash2,
    Check,
    Sparkles,
    Eye,
    Mic,
    Cpu,
    Wifi,
    Wrench,
    ArrowLeft,
    FilePlus,
    Pencil,
} from "lucide-react";
import BackdropPanel from "./BackdropPanel";
import FileAddMenu, { PythonSessionActionMenu } from "./FileAddMenu";



function FilesPanel({
    projectFiles,
    activeFile,
    setActiveFile,
    handleAddPythonFiles,
    handleAddImageFiles,
    handleAddTextFiles,
    handleAddCsvFiles,
    handleDeleteFile,
    onOpenPipPanel,
    onOpenExtensionsPanel,
    onOpenSpritesPanel,
    onAddNewFile,
    onAddNewTextFile,
    onRenameFile,
    hideModules = false,
}) {
    const [renameTarget, setRenameTarget] = React.useState(null);
    const [renameValue, setRenameValue] = React.useState("");
    return (
        <>
            <div className="flex-1 min-h-0 flex flex-col relative">
                <div className="py-2.5 px-3 flex justify-between items-center border-b border-violet-100/50 bg-gradient-to-r from-white via-white to-violet-50/20">
                    <span className="text-xs font-bold bg-gradient-to-r from-violet-700 to-indigo-700 bg-clip-text text-transparent">Project Files</span>
                    <div className="flex gap-1">
                        {onAddNewFile && (
                            <button
                                onClick={onAddNewFile}
                                className="cursor-pointer text-violet-600 p-0.5 rounded border-none bg-transparent hover:bg-violet-50"
                                title="New Python File"
                            >
                                <FilePlus size={14} />
                            </button>
                        )}
                        {onAddNewTextFile && (
                            <button
                                onClick={onAddNewTextFile}
                                className="cursor-pointer text-violet-600 p-0.5 rounded border-none bg-transparent hover:bg-violet-50"
                                title="New Text File"
                            >
                                <FileText size={14} />
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto pt-1 pb-16">
                    {Object.keys(projectFiles).map((file) => (
                        <div
                            key={file}
                            onClick={() => {
                                if (renameTarget !== file) setActiveFile(file);
                            }}
                            className={`py-2 px-3 cursor-pointer flex items-center justify-between gap-2 border-l-[3px] transition-all ${
                                activeFile === file
                                    ? "bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 text-emerald-800 border-emerald-500 shadow-sm"
                                    : "bg-transparent text-slate-700 border-transparent hover:bg-gradient-to-r hover:from-violet-50/60 hover:to-indigo-50/40 hover:text-violet-800"
                            }`}
                        >
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <div className="w-[18px] h-[18px] bg-green-50 rounded flex items-center justify-center shrink-0">
                                    <FileText size={12} className="text-green-600" />
                                </div>
                                {renameTarget === file ? (
                                    <input
                                        autoFocus
                                        value={renameValue}
                                        onChange={(e) => setRenameValue(e.target.value)}
                                        onBlur={() => {
                                            onRenameFile?.(file, renameValue.trim());
                                            setRenameTarget(null);
                                            setRenameValue("");
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                onRenameFile?.(file, renameValue.trim());
                                                setRenameTarget(null);
                                                setRenameValue("");
                                            } else if (e.key === "Escape") {
                                                setRenameTarget(null);
                                                setRenameValue("");
                                            }
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        className={`text-xs ${
                                            activeFile === file ? "font-semibold" : "font-normal"
                                        } border border-violet-500 rounded py-0.5 px-1 outline-none flex-1 min-w-0 bg-white text-gray-800`}
                                    />
                                ) : (
                                    <span
                                        className={`text-xs ${
                                            activeFile === file ? "font-semibold" : "font-normal"
                                        } whitespace-nowrap overflow-hidden text-ellipsis`}
                                        onDoubleClick={(e) => {
                                            e.stopPropagation();
                                            setRenameTarget(file);
                                            setRenameValue(file);
                                        }}
                                    >
                                        {file}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0">
                                {onRenameFile && renameTarget !== file && (
                                    <button
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setRenameTarget(file);
                                            setRenameValue(file);
                                        }}
                                        className="cursor-pointer text-gray-500 p-0.5 rounded border-none bg-transparent opacity-50 hover:opacity-100"
                                        title="Rename file"
                                    >
                                        <Pencil size={12} />
                                    </button>
                                )}
                                {handleDeleteFile && Object.keys(projectFiles).length > 1 && (
                                    <button
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            handleDeleteFile(file);
                                        }}
                                        className="cursor-pointer text-gray-500 p-0.5 rounded border-none bg-transparent opacity-50 hover:opacity-100 hover:text-red-600"
                                        title="Delete file"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                <PythonSessionActionMenu
                    onOpenPipPanel={onOpenPipPanel}
                    onOpenExtensionsPanel={onOpenExtensionsPanel}
                />
                <FileAddMenu
                    onAddPythonFiles={handleAddPythonFiles}
                    onAddImageFiles={handleAddImageFiles}
                    onAddTextFiles={handleAddTextFiles}
                    onAddCsvFiles={handleAddCsvFiles}
                />
            </div>

            {!hideModules && (
                <>
                    <div className="border-t border-violet-100/50 py-2.5 px-3 bg-gradient-to-r from-slate-50 via-white to-violet-50/20">
                        <span className="text-[11px] font-bold bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent tracking-wider">
                            MODULES/LIBRARIES
                        </span>
                    </div>
                    <div className="p-3 pt-2 pb-3 bg-gradient-to-b from-slate-50/50 to-violet-50/20 shrink-0">
                        <div
                            onClick={() => onOpenSpritesPanel?.()}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenSpritesPanel?.(); } }}
                            className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-gradient-to-r from-white to-violet-50/30 border border-violet-200/60 cursor-pointer hover:from-violet-500 hover:to-indigo-500 hover:text-white hover:border-violet-500 hover:shadow-md transition-all select-none group"
                            title="Open Sprite Library"
                        >
                            <Package size={14} className="text-violet-600 group-hover:text-white transition-colors" />
                            <span className="text-xs font-semibold text-slate-700 group-hover:text-white">Sprite</span>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}

function AssetPreview({ entry }) {
    const preview = entry?.img || entry?.image || entry?.emoji;
    const isImage = typeof preview === "string" && (preview.includes("/") || preview.startsWith("data:image"));

    if (isImage) {
        return <img src={preview} alt={entry?.name} className="w-6 h-6 object-contain" />;
    }

    return <span className="text-2xl">{preview || "?"}</span>;
}

function SpritesPanel({
    assetMode = "sprite",
    spriteFilter,
    setSpriteFilter,
    handleSpriteAssetSelect,
    SPRITE_LIBRARY,
    BACKDROP_LIBRARY,
    backdrop,
    handleSetBackdrop,
    onOpenAssetLibrary,
    onBackToFiles,
}) {
    const isCostumeMode = assetMode === "costume";
    const filteredSprites = SPRITE_LIBRARY.filter((sp) =>
        sp.name.toLowerCase().includes(spriteFilter.toLowerCase())
    );

    return (
        <>
            <div className="py-2.5 px-3 border-b border-gray-200">
                {onBackToFiles && (
                    <PanelBackButton onClick={onBackToFiles} />
                )}
                <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold text-gray-800">
                        {isCostumeMode ? "Costume Library" : "Sprite Library"}
                    </span>
                    <button
                        onClick={() => onOpenAssetLibrary?.(isCostumeMode ? "costume" : "sprite")}
                        title={isCostumeMode ? "Browse All Costumes" : "Browse All Sprites"}
                        className="cursor-pointer text-violet-600 p-0.5 rounded border-none bg-transparent hover:bg-violet-50"
                    >
                        <Sparkles size={14} />
                    </button>
                </div>
                <div className="flex items-center gap-1.5 py-1.5 px-2 rounded-md bg-gray-50 border border-gray-200">
                    <Search size={12} className="text-gray-500" />
                    <input
                        value={spriteFilter}
                        onChange={(event) => setSpriteFilter(event.target.value)}
                        placeholder={isCostumeMode ? "Search costumes..." : "Search sprites..."}
                        className="flex-1 border-none bg-transparent text-[11px] outline-none text-gray-800"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
                <div className="grid grid-cols-3 gap-1.5">
                    {filteredSprites.slice(0, 12).map((sp, idx) => (
                        <div
                            key={`${sp.name}-${idx}`}
                            onClick={() => handleSpriteAssetSelect?.(sp)}
                            className="py-2 px-1 rounded-md bg-white border border-gray-200 cursor-pointer text-center transition-colors hover:border-violet-500"
                        >
                            <div className="h-7 mb-1 flex items-center justify-center">
                                <AssetPreview entry={sp} />
                            </div>
                            <div className="text-[9px] text-gray-500 whitespace-nowrap overflow-hidden text-ellipsis">
                                {sp.name}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {!isCostumeMode && (
                <>
                    <div className="border-t border-gray-200 py-2 px-3 bg-gray-50">
                        <span className="text-[11px] font-bold text-gray-500 tracking-wider">
                            BACKDROPS
                        </span>
                    </div>
                    <div className="p-2 max-h-[120px] overflow-y-auto bg-gray-50">
                        <div className="grid grid-cols-4 gap-1">
                            {BACKDROP_LIBRARY.map((bd, idx) => (
                                <div
                                    key={`${bd.id || bd.name}-${idx}`}
                                    onClick={() => handleSetBackdrop(bd)}
                                    className={`p-1.5 rounded text-center text-[9px] cursor-pointer text-gray-800 ${
                                        backdrop === bd.img
                                            ? "bg-violet-100 border-2 border-violet-500 font-bold"
                                            : "bg-white border border-gray-200 hover:border-gray-300"
                                    }`}
                                >
                                    {bd.name}
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </>
    );
}

function PanelBackButton({ onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="inline-flex items-center gap-1 mb-2 py-1 px-2 rounded-full border border-gray-200 bg-white text-gray-500 cursor-pointer text-[10px] font-bold tracking-wider uppercase hover:bg-gray-50"
        >
            <ArrowLeft size={12} />
            Files
        </button>
    );
}

function ExtensionsPanel({ EXTENSIONS, installedExtensions, installExtension, onBackToFiles }) {
    return (
        <>
            <div className="py-2.5 px-3 border-b border-gray-200">
                <PanelBackButton onClick={onBackToFiles} />
                <span className="text-xs font-bold text-gray-800">Extensions</span>
                <div className="text-[11px] text-gray-500 mt-1">Add capabilities to your project</div>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
                {EXTENSIONS.map((ext) => {
                    const isInstalled = installedExtensions.find((entry) => entry.id === ext.id);
                    return (
                        <div
                            key={ext.id}
                            className={`py-2.5 px-3 mb-1.5 rounded-lg border transition-all ${
                                isInstalled
                                    ? "bg-violet-100 border-violet-500 cursor-default"
                                    : "bg-white border-gray-200 cursor-pointer hover:border-violet-400"
                            }`}
                            onClick={() => !isInstalled && installExtension(ext)}
                        >
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-lg">{ext.icon}</span>
                                <span className="text-xs font-semibold text-gray-800">{ext.name}</span>
                                {isInstalled && (
                                    <span className="ml-auto text-[10px] text-emerald-600 font-bold flex items-center gap-0.5">
                                        <Check size={12} className="align-middle" /> Installed
                                    </span>
                                )}
                            </div>
                            <div className="text-[11px] text-gray-500">{ext.desc}</div>
                        </div>
                    );
                })}
            </div>
        </>
    );
}

function PipPackageItem({ pkg, handleInstall }) {
    const getCategoryIcon = (category) => {
        switch (category) {
            case "computer-vision":
                return <Eye size={12} />;
            case "machine-learning":
                return <Sparkles size={12} />;
            case "speech":
                return <Mic size={12} />;
            case "iot":
                return <Wifi size={12} />;
            case "hardware":
                return <Cpu size={12} />;
            case "utility":
                return <Wrench size={12} />;
            default:
                return <Package size={12} />;
        }
    };

    return (
        <div className="py-2 px-3 border-b border-gray-200">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5">
                    <span className={pkg.category ? "text-violet-600" : "text-gray-500"}>{getCategoryIcon(pkg.category)}</span>
                    <span className="text-xs font-semibold text-gray-800">{pkg.name}</span>
                    {pkg.version && (
                        <span className="text-[9px] text-gray-500 bg-gray-100 py-0.5 px-1 rounded">
                            v{pkg.version}
                        </span>
                    )}
                </div>
                {pkg.installed ? (
                    <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-0.75">
                        <Check size={10} /> READY
                    </span>
                ) : (
                    <button
                        onClick={() => handleInstall(pkg.name)}
                        className="text-[10px] py-0.75 px-2 bg-violet-600 hover:bg-violet-700 text-white border-none rounded cursor-pointer font-bold flex items-center gap-0.75 transition-colors"
                    >
                        <Download size={10} /> INSTALL
                    </button>
                )}
            </div>
            <div className="text-[11px] text-gray-500 mt-0.75 ml-4.5">{pkg.desc}</div>
            {pkg.tags && (
                <div className="flex gap-1 mt-1 ml-4.5">
                    {pkg.tags.map((tag, idx) => (
                        <span
                            key={`${pkg.name}-${tag}-${idx}`}
                            className="text-[9px] text-violet-600 bg-violet-100 py-0.5 px-1.25 rounded"
                        >
                            {tag}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}

function PipPanel({ packages, pipFilter, setPipFilter, handleInstall, onBackToFiles }) {
    const filteredPackages = packages.filter(
        (pkg) =>
            pkg.name.toLowerCase().includes(pipFilter.toLowerCase()) ||
            pkg.desc.toLowerCase().includes(pipFilter.toLowerCase())
    );

    const builtinPackages = filteredPackages.filter((pkg) => pkg.builtin);
    const externalPackages = filteredPackages.filter((pkg) => !pkg.builtin);

    return (
        <>
            <div className="py-2.5 px-3 border-b border-gray-200">
                <PanelBackButton onClick={onBackToFiles} />
                <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-bold text-gray-800">PIP Packages</span>
                    <span className="text-[10px] text-gray-500">
                        {packages.filter((pkg) => pkg.installed).length} installed
                    </span>
                </div>
                <div className="flex items-center gap-1.5 py-1.5 px-2 rounded-md bg-gray-50 border border-gray-200">
                    <Search size={12} className="text-gray-500" />
                    <input
                        value={pipFilter}
                        onChange={(event) => setPipFilter(event.target.value)}
                        placeholder="Search packages..."
                        className="flex-1 border-none bg-transparent text-[11px] outline-none text-gray-800"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {!window.electronAPI?.isElectron && (
                    <div className="py-2 px-3 bg-amber-100 border-b border-amber-300 text-[11px] text-amber-800">
                        🌐 Web Mode: Only built-in Python modules are fully functional in-browser.
                    </div>
                )}
                {builtinPackages.length > 0 && (
                    <>
                        <div className="py-2 px-3 pt-2 pb-1 bg-gray-50">
                            <span className="text-[10px] font-bold text-gray-500 tracking-wider">
                                BUILT-IN MODULES
                            </span>
                        </div>
                        {builtinPackages.map((pkg) => (
                            <PipPackageItem key={pkg.name} pkg={pkg} handleInstall={handleInstall} />
                        ))}
                    </>
                )}

                {externalPackages.length > 0 && (
                    <>
                        <div className="py-2 px-3 pt-2 pb-1 bg-gray-50 border-t border-gray-200">
                            <span className="text-[10px] font-bold text-gray-500 tracking-wider">
                                ADVANCED LIBRARIES
                            </span>
                        </div>
                        {externalPackages.map((pkg) => (
                            <PipPackageItem key={pkg.name} pkg={pkg} handleInstall={handleInstall} />
                        ))}
                    </>
                )}

                {filteredPackages.length === 0 && (
                    <div className="p-5 text-center text-gray-500 text-xs">
                        No packages found matching "{pipFilter}"
                    </div>
                )}
            </div>
        </>
    );
}

export default function SidePanel({
    sidePanel = "files",
    setSidePanel,
    projectFiles,
    activeFile,
    assetMode = "sprite",
    setActiveFile,
    handleAddPythonFiles,
    handleAddImageFiles,
    handleAddTextFiles,
    handleAddCsvFiles,
    handleDeleteFile,
    onAddNewFile,
    onAddNewTextFile,
    onRenameFile,
    spriteFilter,
    setSpriteFilter,
    addSpriteFromLibrary,
    handleSpriteAssetSelect,
    SPRITE_LIBRARY,
    BACKDROP_LIBRARY,
    backdrop,
    handleSetBackdrop,
    onOpenAssetLibrary,
    EXTENSIONS,
    installedExtensions,
    installExtension,
    packages,
    pipFilter,
    setPipFilter,
    handleInstall,
    className,
    style,
    hideModules = false,
}) {
    return (
        <div style={style} className={className || "w-60 bg-white border-r border-gray-200 flex flex-col shrink-0 overflow-hidden"}>
            {sidePanel === "files" && (
                <FilesPanel
                    projectFiles={projectFiles}
                    activeFile={activeFile}
                    setActiveFile={setActiveFile}
                    handleAddPythonFiles={handleAddPythonFiles}
                    handleAddImageFiles={handleAddImageFiles}
                    handleAddTextFiles={handleAddTextFiles}
                    handleAddCsvFiles={handleAddCsvFiles}
                    handleDeleteFile={handleDeleteFile}
                    onAddNewFile={onAddNewFile}
                    onAddNewTextFile={onAddNewTextFile}
                    onRenameFile={onRenameFile}
                    onOpenPipPanel={() => setSidePanel?.("pip")}
                    onOpenExtensionsPanel={() => setSidePanel?.("extensions")}
                    onOpenSpritesPanel={() => setSidePanel?.("sprites")}
                    hideModules={hideModules}
                />
            )}

            {sidePanel === "sprites" && (
                <SpritesPanel
                    assetMode={assetMode}
                    spriteFilter={spriteFilter}
                    setSpriteFilter={setSpriteFilter}
                    handleSpriteAssetSelect={handleSpriteAssetSelect || addSpriteFromLibrary}
                    SPRITE_LIBRARY={SPRITE_LIBRARY}
                    BACKDROP_LIBRARY={BACKDROP_LIBRARY}
                    backdrop={backdrop}
                    handleSetBackdrop={handleSetBackdrop}
                    onOpenAssetLibrary={onOpenAssetLibrary}
                    onBackToFiles={() => setSidePanel?.("files")}
                />
            )}

            {sidePanel === "backdrops" && (
                <BackdropPanel
                    BACKDROP_LIBRARY={BACKDROP_LIBRARY}
                    backdrop={backdrop}
                    handleSetBackdrop={handleSetBackdrop}
                    onBrowseBackdrops={() => onOpenAssetLibrary?.("backdrop")}
                />
            )}

            {sidePanel === "extensions" && (
                <ExtensionsPanel
                    EXTENSIONS={EXTENSIONS}
                    installedExtensions={installedExtensions}
                    installExtension={installExtension}
                    onBackToFiles={() => setSidePanel?.("files")}
                />
            )}

            {sidePanel === "pip" && (
                <PipPanel
                    packages={packages}
                    pipFilter={pipFilter}
                    setPipFilter={setPipFilter}
                    handleInstall={handleInstall}
                    onBackToFiles={() => setSidePanel?.("files")}
                />
            )}
        </div>
    );
}
