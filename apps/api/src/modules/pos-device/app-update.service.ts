/**
 * Desktop kassa yangilanishi: joriy reliz server muhit o'zgaruvchilarida (Railway) —
 *   DESKTOP_LATEST_VERSION  1.2.3
 *   DESKTOP_DOWNLOAD_URL    https://… (NSIS o'rnatuvchi)
 *   DESKTOP_SHA256          o'rnatuvchi fayl SHA-256 (64 hex) — qurilma yuklab olgach tekshiradi
 *   DESKTOP_MIN_VERSION     (ixtiyoriy) bundan eski versiya — majburiy yangilanish
 *   DESKTOP_RELEASE_NOTES   (ixtiyoriy) qisqa izoh
 * To'liq sozlanmagan (yoki https/sha256 noto'g'ri) — yangilanish taklif qilinmaydi.
 */
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function compareVersions(a: string, b: string): number {
  const left = SEMVER.exec(a)!.slice(1).map(Number);
  const right = SEMVER.exec(b)!.slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
  return 0;
}

export type DesktopUpdate = {
  configured: boolean;
  available: boolean;
  mandatory: boolean;
  current: string | null;
  latest: string | null;
  url: string | null;
  sha256: string | null;
  notes: string | null;
};

export function desktopUpdate(current: string | undefined, env: NodeJS.ProcessEnv = process.env): DesktopUpdate {
  const version = current && SEMVER.test(current) ? current : null;
  const latest = env.DESKTOP_LATEST_VERSION?.trim() ?? "";
  const url = env.DESKTOP_DOWNLOAD_URL?.trim() ?? "";
  const sha256 = env.DESKTOP_SHA256?.trim().toLowerCase() ?? "";
  const minimum = env.DESKTOP_MIN_VERSION?.trim() ?? "";
  if (!SEMVER.test(latest) || !url.startsWith("https://") || !/^[a-f0-9]{64}$/.test(sha256)) {
    return { configured: false, available: false, mandatory: false, current: version, latest: null, url: null, sha256: null, notes: null };
  }
  return {
    configured: true,
    available: version !== null && compareVersions(latest, version) > 0,
    mandatory: version !== null && SEMVER.test(minimum) && compareVersions(version, minimum) < 0,
    current: version,
    latest,
    url,
    sha256,
    notes: env.DESKTOP_RELEASE_NOTES?.trim().slice(0, 2000) || null,
  };
}
