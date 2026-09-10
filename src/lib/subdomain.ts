/**
 * Subdomain detection utility for BUM ERP multi-surface routing.
 *
 * admin.bum-erp.uz  → isAdminSubdomain = true   → Admin Panel UI
 * app.bum-erp.uz    → isAdminSubdomain = false  → Normal ERP UI
 * localhost         → honour ?surface=admin for dev convenience
 */

export function getSubdomain(): string | null {
  if (typeof window === "undefined") return null;
  const hostname = window.location.hostname;
  const parts = hostname.split(".");
  // e.g. admin.bum-erp.uz → ["admin","bum-erp","uz"] → parts[0] = "admin"
  if (parts.length >= 3) return parts[0];
  return null;
}

export function isAdminSubdomain(): boolean {
  const sub = getSubdomain();
  if (sub === "admin") return true;
  // Dev convenience: ?surface=admin on localhost / preview hosts
  if (typeof window !== "undefined") {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("surface") === "admin") return true;
  }
  return false;
}
