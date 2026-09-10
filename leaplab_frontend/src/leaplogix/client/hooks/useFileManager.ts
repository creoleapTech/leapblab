/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import { useState, useCallback, useEffect } from "react"
import { fileService } from "../../../Electra/Client/Src/services/FileService"
import { useCloudProjectStore } from "../../../store/cloudProjectStore"
import { getUniqueFileName, getFallbackActiveFile } from "../utils/fileUtils"
import { showToast } from "../../../leapignite/client/components/Toast"
import type { SpriteState } from "../../../stage/Sprite"

const DEFAULT_ACTIVE_FILE = "main.py"
const DEFAULT_FILES: Record<string, string> = {
  [DEFAULT_ACTIVE_FILE]: 'print("Hello from LeapBlocks Python!")\n',
}

interface UseFileManagerProps {
  addLog: (message: string, type: string) => void
  sprites: SpriteState[]
  backdrop: string | null
  setSprites: (sprites: SpriteState[]) => void
  setSelectedSpriteId: (id: string) => void
  setBackdropImg: (img: string | null) => void
  resetStage: () => void
  workflowMode?: string
  setWorkflowMode?: (mode: string) => void
}

export function useFileManager({ addLog, sprites, backdrop, setSprites, setSelectedSpriteId, setBackdropImg, resetStage, workflowMode, setWorkflowMode }: UseFileManagerProps) {
  const [projectName, setProjectName] = useState("My Project")
  const [activeFile, setActiveFile] = useState(DEFAULT_ACTIVE_FILE)
  const [projectFiles, setProjectFiles] = useState<Record<string, string>>(DEFAULT_FILES)

  const handleNewProject = useCallback(() => {
    if (!window.confirm("Create a new project? All unsaved work will be lost.")) return
    setProjectName("My Project")
    setProjectFiles(DEFAULT_FILES)
    setActiveFile(DEFAULT_ACTIVE_FILE)
    resetStage()
  }, [resetStage])

  const buildPayload = useCallback(() => ({
    mode: "python",
    workflowMode: workflowMode || "ide",
    editorMode: workflowMode || "ide",
    version: "1.0",
    projectFiles,
    activeFile,
    sprites,
    backdrop,
  }), [workflowMode, projectFiles, activeFile, sprites, backdrop])

  const handleSaveProject = useCallback(async () => {
    const payload = buildPayload()
    try {
      await fileService.saveProject(projectName, "python", payload)
      showToast("Project saved successfully!", "success")
    } catch (err) {
      console.error('[useFileManager] Failed to save project:', err)
      alert((err as { message?: string })?.message || 'Failed to save project. Please make sure you are signed in.')
    }
  }, [projectName, buildPayload])

  const handleDownloadProject = useCallback(() => {
    const payload = buildPayload()
    fileService.saveProjectLocally(projectName, "python", payload)
  }, [projectName, buildPayload])

  const loadProjectData = useCallback((data: any) => {
    try {
      const validation = fileService.validateProject(data, "python")
      if (!validation.isValid) {
        alert(validation.error)
        return
      }

      const savedMode = data.workflowMode || data.editorMode
      if (savedMode && (savedMode === "ide" || savedMode === "upload") && setWorkflowMode) {
        setWorkflowMode(savedMode)
      }

      const nextProjectFiles = data.projectFiles && Object.keys(data.projectFiles).length ? data.projectFiles : DEFAULT_FILES
      setProjectName(data.projectName || "My Project")
      setProjectFiles(nextProjectFiles)
      setActiveFile(getFallbackActiveFile(nextProjectFiles, data.activeFile))

      if (data.sprites && Array.isArray(data.sprites) && data.sprites.length > 0) {
        setSprites(data.sprites)
        setSelectedSpriteId(data.sprites[0].id)
      } else {
        resetStage()
      }
      if (data.backdrop) setBackdropImg(data.backdrop)
    } catch (err) {
      alert('Failed to load project: ' + (err as Error).message)
    }
  }, [setSprites, setSelectedSpriteId, setBackdropImg, resetStage, setWorkflowMode])

  const handleOpenProject = useCallback(() => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = '.leap,.lbproject,application/json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      try {
        const data = await fileService.loadProject(file)
        loadProjectData(data)
      } catch (err) {
        alert('Failed to load project: ' + (err as Error).message)
      }
    }
    input.click()
  }, [loadProjectData])

  useEffect(() => {
    const { pendingProject, clearPendingProject } = useCloudProjectStore.getState()
    if (!pendingProject || pendingProject.mode !== 'python') return

    let cancelled = false
      ; (async () => {
        try {
          if (cancelled) return
          loadProjectData(pendingProject.data)
          clearPendingProject()
        } catch (err) {
          console.error('[useFileManager] Failed to load project from cloud:', err)
          alert('Failed to load project: ' + (err as Error).message)
        }
      })()

    return () => { cancelled = true }
  }, [loadProjectData])

  const handleShareProject = useCallback(() => {
    const payload = {
      projectFiles,
      activeFile,
      sprites,
      backdrop,
    }
    fileService.shareProject(projectName, "python", payload)
  }, [projectName, projectFiles, activeFile, sprites, backdrop])

  const handleDeleteFile = useCallback((file: string) => {
    if (Object.keys(projectFiles).length <= 1) return
    if (!window.confirm(`Delete ${file}?`)) return
    setProjectFiles(prev => {
      const next = { ...prev }
      delete next[file]
      return next
    })
    if (activeFile === file) setActiveFile(Object.keys(projectFiles).find(f => f !== file)!)
  }, [projectFiles, activeFile])

  const handleCreateNewFile = useCallback(() => {
    let baseName = "new_file"
    let ext = ".py"
    let fileName = `${baseName}${ext}`
    let counter = 1
    while (projectFiles[fileName]) {
      fileName = `${baseName}${counter}${ext}`
      counter++
    }
    setProjectFiles((prev) => ({
      ...prev,
      [fileName]: "",
    }))
    setActiveFile(fileName)
    addLog(`Created new file: ${fileName}`, "success")
  }, [projectFiles, addLog])

  const handleCreateNewTextFile = useCallback(() => {
    let baseName = "new_file"
    let ext = ".txt"
    let fileName = `${baseName}${ext}`
    let counter = 1
    while (projectFiles[fileName]) {
      fileName = `${baseName}${counter}${ext}`
      counter++
    }
    setProjectFiles((prev) => ({
      ...prev,
      [fileName]: "",
    }))
    setActiveFile(fileName)
    addLog(`Created new file: ${fileName}`, "success")
  }, [projectFiles, addLog])

  const handleRenameFile = useCallback((oldName: string, newName: string) => {
    if (!newName || newName === oldName) return
    if (projectFiles[newName]) {
      alert(`A file named "${newName}" already exists.`)
      return
    }
    setProjectFiles((prev) => {
      const entries = Object.entries(prev)
      const next: Record<string, string> = {}
      entries.forEach(([name, content]) => {
        if (name === oldName) {
          next[newName] = content
        } else {
          next[name] = content
        }
      })
      return next
    })
    if (activeFile === oldName) {
      setActiveFile(newName)
    }
    addLog(`Renamed ${oldName} to ${newName}`, "success")
  }, [projectFiles, activeFile, addLog])

  const handleOpenPythonFile = useCallback(() => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".py"
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const reader = new FileReader()
        reader.onload = (event) => {
          const content = String(event.target?.result || "")
          const fileName = getUniqueFileName(file.name, projectFiles)
          setProjectFiles((prev) => ({ ...prev, [fileName]: content }))
          setActiveFile(fileName)
          addLog(`Loaded Python file: ${fileName}`, "success")
        }
        reader.readAsText(file)
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to open Python file."
        addLog(message, "error")
      }
    }
    input.click()
  }, [projectFiles, addLog])

  const handleAddPythonFiles = useCallback(() => {
    handleCreateNewFile()
  }, [handleCreateNewFile])

  const handleAddImageFiles = useCallback(() => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "image/*"
    input.multiple = true
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files
      if (!files || files.length === 0) return
      for (const file of Array.from(files)) {
        const reader = new FileReader()
        reader.onload = (event) => {
          const content = String(event.target?.result || "")
          const fileName = getUniqueFileName(file.name, projectFiles)
          setProjectFiles((prev) => ({ ...prev, [fileName]: content }))
          setActiveFile(fileName)
          addLog(`Added image file: ${fileName}`, "success")
        }
        reader.readAsDataURL(file)
      }
    }
    input.click()
  }, [projectFiles, addLog])

  const handleAddTextFiles = useCallback(() => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".txt,.md,.json"
    input.multiple = true
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files
      if (!files || files.length === 0) return
      for (const file of Array.from(files)) {
        const reader = new FileReader()
        reader.onload = (event) => {
          const content = String(event.target?.result || "")
          const fileName = getUniqueFileName(file.name, projectFiles)
          setProjectFiles((prev) => ({ ...prev, [fileName]: content }))
          setActiveFile(fileName)
          addLog(`Added text file: ${fileName}`, "success")
        }
        reader.readAsText(file)
      }
    }
    input.click()
  }, [projectFiles, addLog])

  const handleAddCsvFiles = useCallback(() => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".csv"
    input.multiple = true
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files
      if (!files || files.length === 0) return
      for (const file of Array.from(files)) {
        const reader = new FileReader()
        reader.onload = (event) => {
          const content = String(event.target?.result || "")
          const fileName = getUniqueFileName(file.name, projectFiles)
          setProjectFiles((prev) => ({ ...prev, [fileName]: content }))
          setActiveFile(fileName)
          addLog(`Added CSV file: ${fileName}`, "success")
        }
        reader.readAsText(file)
      }
    }
    input.click()
  }, [projectFiles, addLog])

  return {
    projectName,
    setProjectName,
    activeFile,
    setActiveFile,
    projectFiles,
    setProjectFiles,
    handleNewProject,
    handleSaveProject,
    handleDownloadProject,
    handleOpenProject,
    handleShareProject,
    handleDeleteFile,
    handleCreateNewFile,
    handleCreateNewTextFile,
    handleRenameFile,
    handleOpenPythonFile,
    handleAddPythonFiles,
    handleAddImageFiles,
    handleAddTextFiles,
    handleAddCsvFiles,
  }
}

export default useFileManager
