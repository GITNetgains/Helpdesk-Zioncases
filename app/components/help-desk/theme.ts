import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

// Admin colour scheme: Auto follows the computer's setting, Light and Dark
// force one. Saved in this browser, so everyone on the team picks their own.
export type ThemeMode = "auto" | "light" | "dark";
export const THEME_MODES: readonly ThemeMode[] = ["auto", "light", "dark"];

const STORAGE_KEY = "hd-theme";
const CHANGE_EVENT = "hd-theme-change";
// Polaris 2 ships the admin's dark palette behind this class. Polaris tokens
// are inherited, so every Polaris component inside the shell turns dark too.
// If a future Polaris drops the class, only the components stay light; the
// app's own colours still switch.
export const POLARIS_DARK_CLASS = "p-partial-theme-admin-next-dark";
export const DARK_CLASS = "hd-theme-dark";

export function readThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return THEME_MODES.includes(saved as ThemeMode) ? saved as ThemeMode : "auto";
  } catch {
    return "auto";
  }
}

export function saveThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Private mode: the choice still applies until the page reloads.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: mode }));
}

// Switching with a flourish: the new look spreads in a circle from where it
// was chosen (the button), with the browser's view transitions. Without them,
// or with reduced motion, it simply switches.
export function switchTheme(mode: ThemeMode, from?: { x: number; y: number }) {
  const doc = document as Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };
  if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { saveThemeMode(mode); return; }
  const x = from?.x ?? window.innerWidth / 2;
  const y = from?.y ?? 0;
  const root = document.documentElement;
  root.style.setProperty("--hd-vt-x", `${x}px`);
  root.style.setProperty("--hd-vt-y", `${y}px`);
  root.style.setProperty("--hd-vt-r", `${Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))}px`);
  root.classList.add("hd-theme-switching");
  const dark = mode === "dark" || (mode === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const transition = doc.startViewTransition(() => {
    // The new look has to be on the page before the browser takes its picture.
    flushSync(() => saveThemeMode(mode));
    root.classList.toggle(DARK_CLASS, dark);
  });
  void transition.finished.finally(() => root.classList.remove("hd-theme-switching"));
}

// The chosen mode and whether the page is dark right now. Stays in step with
// the settings page, other tabs and the computer switching light/dark.
// `ready` is false until the browser's saved choice has been read.
export function useThemeMode(): { mode: ThemeMode; dark: boolean; ready: boolean } {
  const [mode, setMode] = useState<ThemeMode | null>(null);
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = (event?: Event) => {
      const detail = (event as CustomEvent<ThemeMode> | undefined)?.detail;
      setMode(THEME_MODES.includes(detail as ThemeMode) ? detail as ThemeMode : readThemeMode());
      setSystemDark(media.matches);
    };
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    media.addEventListener("change", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
      media.removeEventListener("change", sync);
    };
  }, []);
  const current = mode ?? "auto";
  return { mode: current, dark: current === "dark" || (current === "auto" && systemDark), ready: mode !== null };
}

// Runs inside the shell before React hydrates, so a dark page never flashes white.
export const THEME_BOOT_SCRIPT = `(function(s){try{var m=localStorage.getItem("${STORAGE_KEY}");if(m==="dark"||(m!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches)){s.classList.add("${DARK_CLASS}","${POLARIS_DARK_CLASS}");document.documentElement.classList.add("${DARK_CLASS}");}}catch(e){}})(document.currentScript.parentElement)`;
