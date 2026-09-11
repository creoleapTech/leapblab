import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
    const [theme, setTheme] = useState(() => {
        try {
            const saved = localStorage.getItem("leaplogix-theme");
            if (saved === "light" || saved === "dark") return saved;
        } catch {}
        // Slight dark blue default as requested, but respect system if light preferred
        if (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
            return "light";
        }
        return "dark";
    });

    useEffect(() => {
        try { localStorage.setItem("leaplogix-theme", theme); } catch {}
        // Apply to the Logix subtree only via data attribute + html class for Tailwind dark:
        // We use html.dark for Tailwind, but TopBar is excluded by not being inside the themed container
        // Instead we toggle class on the Logix root (see LogixApp)
        document.documentElement.classList.toggle("dark", theme === "dark");
        document.documentElement.dataset.logixTheme = theme;
    }, [theme]);

    const toggle = useCallback(() => setTheme(prev => prev === "dark" ? "light" : "dark"), []);

    return (
        <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const ctx = useContext(ThemeContext);
    if (!ctx) return { theme: "dark", toggle: () => {}, setTheme: () => {} };
    return ctx;
}

export default ThemeContext;
