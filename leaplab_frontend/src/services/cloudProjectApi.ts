/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 */
import { useLeapLabAuthStore } from '../auth/leaplabAuthStore';
import { LMS_PROJECTS_URL } from '../config/api';

export interface CloudProject {
    id: string;
    institutionId: string;
    credentialId: string;
    name: string;
    description: string | null;
    mode: string;
    fileKey: string | null;
    thumbnailKey: string | null;
    metadata: string | null;
    isShared: number;
    shareId: string | null;
    sharePermission: 'viewer' | 'editor' | null;
    isActive: number;
    isDeleted: number;
    createdAt: string | null;
    updatedAt: string | null;
    fileUrl: string | null;
    thumbnailUrl: string | null;
}

export interface CloudProjectListResponse {
    success: boolean;
    data: CloudProject[];
}

export interface CloudProjectResponse {
    success: boolean;
    data: CloudProject;
}

export interface SaveProjectPayload {
    projectName: string;
    mode: string;
    payload: any;
    description?: string;
    metadata?: Record<string, any>;
    thumbnail?: Blob | File | null;
}

function getAuthHeaders(): Record<string, string> {
    const token = useLeapLabAuthStore.getState().token;
    const headers: Record<string, string> = {};
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

async function handleResponse<T>(response: Response): Promise<T> {
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
        throw new Error(data?.message || `Request failed with status ${response.status}`);
    }
    return data as T;
}

export async function saveProjectToCloud({
    projectName,
    mode,
    payload,
    description,
    metadata,
    thumbnail,
}: SaveProjectPayload): Promise<CloudProject> {
    const projectData = {
        version: '1.0',
        projectName,
        mode,
        timestamp: Date.now(),
        ...payload,
    };

    const file = new File(
        [JSON.stringify(projectData, null, 2)],
        `${projectName.replace(/\s+/g, '_')}.leap`,
        { type: 'application/json' },
    );

    const formData = new FormData();
    formData.append('name', projectName);
    formData.append('mode', mode);
    formData.append('file', file);

    if (description) {
        formData.append('description', description);
    }

    if (metadata) {
        formData.append('metadata', JSON.stringify(metadata));
    }

    if (thumbnail) {
        formData.append('thumbnail', thumbnail, 'thumbnail.png');
    }

    const response = await fetch(LMS_PROJECTS_URL, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
    });

    const result = await handleResponse<CloudProjectResponse>(response);
    return result.data;
}

export async function listMyProjects(mode?: string): Promise<CloudProject[]> {
    const url = new URL(LMS_PROJECTS_URL);
    if (mode) {
        url.searchParams.set('mode', mode);
    }

    const response = await fetch(url.toString(), {
        method: 'GET',
        headers: getAuthHeaders(),
    });

    const result = await handleResponse<CloudProjectListResponse>(response);
    return result.data;
}

export async function getCloudProject(projectId: string): Promise<CloudProject> {
    const response = await fetch(`${LMS_PROJECTS_URL}/${projectId}`, {
        method: 'GET',
        headers: getAuthHeaders(),
    });

    const result = await handleResponse<CloudProjectResponse>(response);
    return result.data;
}

export async function fetchCloudProjectContent(fileUrl: string): Promise<any> {
    try {
        const response = await fetch(fileUrl, {
            method: 'GET',
        });

        if (!response.ok) {
            if (response.status === 401) {
                throw new Error('Authentication required. Please sign in to access this project.');
            }
            throw new Error(`Failed to fetch project content: ${response.status}`);
        }

        const text = await response.text();
        // Mirror the dashboard preview: some stored files are pako-packed
        // ('___LBC' magic). Plain JSON.parse would throw on those.
        const { isPacked, unpack } = await import('../Electra/Client/utils/compress');
        try {
            return isPacked(text) ? unpack<any>(text) : JSON.parse(text);
        } catch (parseErr) {
            // Fall back to packed-decoding in case the magic check missed
            // (e.g. leading whitespace/BOM on the stored file).
            try {
                return unpack<any>(text.trim());
            } catch {
                throw parseErr;
            }
        }
    } catch (e: any) {
        if (e?.message?.includes('Failed to fetch') || e?.name === 'TypeError') {
            throw new Error('Network error. Please check your internet connection and try again.');
        }
        throw e;
    }
}

export async function updateCloudProject(
    projectId: string,
    payload: SaveProjectPayload,
): Promise<CloudProject> {
    const projectData = {
        version: '1.0',
        projectName: payload.projectName,
        mode: payload.mode,
        timestamp: Date.now(),
        ...payload.payload,
    };

    const file = new File(
        [JSON.stringify(projectData, null, 2)],
        `${payload.projectName.replace(/\s+/g, '_')}.leap`,
        { type: 'application/json' },
    );

    const formData = new FormData();
    formData.append('name', payload.projectName);
    formData.append('mode', payload.mode);
    formData.append('file', file);

    if (payload.description) {
        formData.append('description', payload.description);
    }

    if (payload.metadata) {
        formData.append('metadata', JSON.stringify(payload.metadata));
    }

    if (payload.thumbnail) {
        formData.append('thumbnail', payload.thumbnail, 'thumbnail.png');
    }

    const response = await fetch(`${LMS_PROJECTS_URL}/${projectId}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: formData,
    });

    const result = await handleResponse<CloudProjectResponse>(response);
    return result.data;
}

export async function renameCloudProject(projectId: string, name: string): Promise<CloudProject> {
    const formData = new FormData();
    formData.append('name', name);

    const response = await fetch(`${LMS_PROJECTS_URL}/${projectId}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: formData,
    });

    const result = await handleResponse<CloudProjectResponse>(response);
    return result.data;
}

export async function deleteCloudProject(projectId: string): Promise<void> {
    const response = await fetch(`${LMS_PROJECTS_URL}/${projectId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
    });

    await handleResponse<{ success: boolean; message?: string }>(response);
}

export async function shareCloudProject(
    projectId: string,
    permission: 'viewer' | 'editor',
): Promise<CloudProject> {
    const response = await fetch(`${LMS_PROJECTS_URL}/${projectId}/share`, {
        method: 'POST',
        headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ permission }),
    });

    const result = await handleResponse<CloudProjectResponse>(response);
    return result.data;
}

export async function revokeCloudProjectShare(projectId: string): Promise<CloudProject> {
    const response = await fetch(`${LMS_PROJECTS_URL}/${projectId}/share`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
    });

    const result = await handleResponse<CloudProjectResponse>(response);
    return result.data;
}

export async function getSharedProject(shareId: string): Promise<CloudProject> {
    try {
        const response = await fetch(`${LMS_PROJECTS_URL}/share/${shareId}`, {
            method: 'GET',
        });

        const result = await handleResponse<CloudProjectResponse>(response);
        return result.data;
    } catch (e: any) {
        if (e?.message?.includes('401')) {
            throw new Error('Authentication required. Please sign in to access this shared project.');
        }
        if (e?.message?.includes('Failed to fetch') || e?.name === 'TypeError') {
            throw new Error('Network error. Please check your internet connection and try again.');
        }
        throw e;
    }
}

export function getShareUrl(shareId: string): string {
    const baseUrl =
        (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_APP_URL) ||
        'https://leaplab.creoleap.com';
    return `${baseUrl.replace(/\/$/, '')}/?share=${encodeURIComponent(shareId)}`;
}

export async function updateSharedProject(
    shareId: string,
    payload: SaveProjectPayload,
): Promise<CloudProject> {
    const projectData = {
        version: '1.0',
        projectName: payload.projectName,
        mode: payload.mode,
        timestamp: Date.now(),
        ...payload.payload,
    };

    const file = new File(
        [JSON.stringify(projectData, null, 2)],
        `${payload.projectName.replace(/\s+/g, '_')}.leap`,
        { type: 'application/json' },
    );

    const formData = new FormData();
    formData.append('name', payload.projectName);
    formData.append('file', file);

    if (payload.thumbnail) {
        formData.append('thumbnail', payload.thumbnail, 'thumbnail.png');
    }

    const response = await fetch(`${LMS_PROJECTS_URL}/share/${shareId}`, {
        method: 'PATCH',
        body: formData,
    });

    const result = await handleResponse<CloudProjectResponse>(response);
    return result.data;
}
