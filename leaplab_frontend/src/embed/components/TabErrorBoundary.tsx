/**
 * Copyright (c) 2026 Creoleap Technologies Pvt. Ltd.
 * All rights reserved. Proprietary and confidential.
 * Unauthorized copying, distribution, or modification is strictly prohibited.
 */
import React from 'react';
import Loader from '../../components/Loader';
import { isChunkLoadError } from '../../utils/lazyWithRetry';

// Local ErrorBoundary for tab panels — prevents PaintEditor/fabric.js crashes from killing the whole app
export class TabErrorBoundary extends React.Component<
    { children: React.ReactNode; onBackToBlocks?: () => void; tabName?: string },
    { hasError: boolean; error: any }
> {
    constructor(props: any) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error: any) {
        return { hasError: true, error };
    }
    componentDidCatch(error: any, errorInfo: any) {
        console.error(`[TabErrorBoundary] ${this.props.tabName || 'Tab'} crashed:`, error, errorInfo);
        if (isChunkLoadError(error)) {
            try {
                const hasRetried = sessionStorage.getItem('chunk-retry') === '1';
                if (!hasRetried) {
                    console.warn('[TabErrorBoundary] auto-reload for stale chunk', (error as any)?.message);
                    sessionStorage.setItem('chunk-retry', '1');
                    const url = new URL(window.location.href);
                    url.searchParams.set('_r', Date.now().toString());
                    window.location.replace(url.toString());
                    setTimeout(() => { try { window.location.reload(); } catch {} }, 150);
                    return;
                }
            } catch {}
        }
    }
    render() {
        if (this.state.hasError) {
            const isChunkError = isChunkLoadError(this.state.error);
            const tabLabel = this.props.tabName || 'tab';
            return (
                <div style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    height: '100%', padding: 24, background: '#1a1a2e', color: '#e0e0e0', fontFamily: 'monospace',
                }}>
                    <div style={{ fontSize: 14, color: '#ff6b6b', marginBottom: 8 }}>
                        Failed to load {tabLabel}
                    </div>
                    <pre style={{
                        fontSize: 11, color: '#999', maxWidth: '100%', overflow: 'auto',
                        maxHeight: 80, marginBottom: 16, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                        {this.state.error?.message || String(this.state.error)}
                    </pre>
                    {isChunkError && (
                        <div style={{ fontSize: 11, color: '#fbbf24', marginBottom: 12, textAlign: 'center', maxWidth: 420 }}>
                            A new version is available. If retry doesn't work, the page will reload automatically.
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button
                            onClick={() => {
                                if (isChunkError) {
                                    try { sessionStorage.removeItem('chunk-retry'); } catch {}
                                    const url = new URL(window.location.href);
                                    url.searchParams.set('_r', Date.now().toString());
                                    window.location.replace(url.toString());
                                    setTimeout(() => { try { window.location.reload(); } catch {} }, 200);
                                } else {
                                    this.setState({ hasError: false, error: null });
                                }
                            }}
                            style={{
                                padding: '6px 14px', borderRadius: 6, border: '1px solid #555',
                                background: '#2a2a3e', color: '#ccc', cursor: 'pointer', fontSize: 12,
                            }}
                        >
                            {isChunkError ? 'Reload' : 'Retry'}
                        </button>
                        {this.props.onBackToBlocks && (
                            <button
                                onClick={this.props.onBackToBlocks}
                                style={{
                                    padding: '6px 14px', borderRadius: 6, border: 'none',
                                    background: '#5A2D82', color: '#fff', cursor: 'pointer', fontSize: 12,
                                }}
                            >
                                Back to Blocks
                            </button>
                        )}
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

// Suspense wrapper that handles both loading and chunk-load errors
export function SuspenseTab({ children, onBackToBlocks, tabName }: { children: React.ReactNode; onBackToBlocks?: () => void; tabName?: string }) {
    return (
        <TabErrorBoundary onBackToBlocks={onBackToBlocks} tabName={tabName}>
            <React.Suspense fallback={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#1a1a2e' }}>
                    <Loader />
                </div>
            }>
                {children}
            </React.Suspense>
        </TabErrorBoundary>
    );
}
