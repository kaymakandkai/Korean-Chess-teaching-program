// 사용자 설정 (브라우저에만 저장)
export interface Settings {
  /** 기물 글자: 한자 / 한글 */
  hanja: boolean;
  sound: boolean;
  coords: boolean;
  animate: boolean;
}

const KEY = 'waryong.settings.v1';
const DEFAULTS: Settings = { hanja: true, sound: true, coords: true, animate: true };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* 저장소 사용 불가 */
  }
  return { ...DEFAULTS };
}

export const settings: Settings = load();
const listeners = new Set<() => void>();

export function updateSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* 무시 */
  }
  listeners.forEach((f) => f());
}

export function onSettingsChange(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** 마지막으로 고른 대국 설정 기억 */
export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem('waryong.pref.' + key);
    if (raw) return { ...fallback, ...JSON.parse(raw) };
  } catch {
    /* 무시 */
  }
  return fallback;
}
export function savePref(key: string, value: unknown) {
  try {
    localStorage.setItem('waryong.pref.' + key, JSON.stringify(value));
  } catch {
    /* 무시 */
  }
}
