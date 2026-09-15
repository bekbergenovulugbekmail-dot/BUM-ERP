/**
 * Desktop kassa relizlari — `GET /api/platform/desktop-releases`, bo'laklab yuklash `POST …/uploads`,
 * `PUT …/uploads/:id/chunks/:index`, `POST …/uploads/:id/complete|abort`, `PATCH …/:id`, `POST …/:id/publish|archive`.
 *
 * O'rnatuvchi 8 MB bo'laklarda yuklanadi: aloqa uzilsa yoki sahifa yangilansa, shu faylni qayta tanlab «Yuklash» bosiladi —
 * server qabul qilgan bo'laklar qayta yuborilmaydi (0% dan emas). Har bo'lak SHA-256 bilan yuboriladi (yo'lda buzilsa —
 * qayta), yakunda butun fayl SHA-256 si serverda solishtiriladi; mos kelmasa reliz yaroqsiz va e'lon qilinmaydi.
 * Bir vaqtda bitta reliz e'lon qilingan — yangisi e'lon qilinsa oldingisi arxivga o'tadi.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Archive, Loader2, MonitorDown, Pause, Rocket, Save, Trash2, Upload } from "lucide-react";
import { Sha256 } from "@bum/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { ApiError, api, apiUrl, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import type { DesktopRelease, ReleaseUpload } from "../_lib/types.ts";

const RELEASES_PATH = "/api/platform/desktop-releases";
const UPLOADS_PATH = `${RELEASES_PATH}/uploads`;
const CHUNK_BYTES = 8 * 1024 * 1024;
const PARALLEL_CHUNKS = 3;
const MAX_ATTEMPTS = 6;
const VERSION = /^\d{1,4}\.\d{1,5}\.\d{1,6}$/;
const FILE_NAME = /^[\w .()-]+\.exe$/i;
const inputClass = "bg-white/5 border-white/10 text-white placeholder:text-white/30";

const STATUS: Record<DesktopRelease["status"], { label: string; className: string }> = {
  uploading: { label: "Yuklanmoqda (qisman)", className: "bg-sky-400/10 text-sky-300 border-sky-400/30" },
  draft: { label: "Tayyor (tekshirilgan)", className: "bg-amber-400/10 text-amber-300 border-amber-400/30" },
  published: { label: "E'lon qilingan", className: "bg-emerald-400/10 text-emerald-300 border-emerald-400/30" },
  archived: { label: "Arxiv", className: "bg-white/5 text-white/50 border-white/10" },
  failed: { label: "Yaroqsiz", className: "bg-red-400/10 text-red-300 border-red-400/30" },
};

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const percent = (part: number, total: number) => (total > 0 ? Math.floor((part / total) * 100) : 0);
const fmtDate = (value: string | null) =>
  value ? new Date(value).toLocaleString("uz-UZ", { dateStyle: "short", timeStyle: "short" }) : "—";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Tarmoq uzilishi, 5xx va 429 — qayta urinish mumkin; 4xx (noto'g'ri bo'lak hajmi va h.k.) — yo'q. */
const retryable = (error: unknown) => !(error instanceof ApiError) || error.status === 0 || error.status === 429 || error.status >= 500 || error.status === 400 && (error.details as { reason?: string } | undefined)?.reason === "chunk_checksum";

async function sendChunk(uploadId: string, index: number, blob: Blob, signal: AbortSignal) {
  const body = await blob.arrayBuffer();
  const checksum = hex(await crypto.subtle.digest("SHA-256", body));
  let response: Response;
  try {
    response = await fetch(apiUrl(`${UPLOADS_PATH}/${uploadId}/chunks/${index}`), {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/octet-stream", "x-chunk-sha256": checksum },
      body,
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ApiError(0, "NETWORK", "Server bilan aloqa uzildi");
  }
  const payload = (await response.json().catch(() => null)) as { receivedBytes?: number; code?: string; message?: string; details?: unknown } | null;
  if (!response.ok) throw new ApiError(response.status, payload?.code ?? "BAD_REQUEST", payload?.message ?? `HTTP ${response.status}`, payload?.details);
  return payload?.receivedBytes ?? 0;
}

type Phase = { kind: "idle" } | { kind: "hashing"; done: number } | { kind: "uploading" } | { kind: "completing" } | { kind: "paused"; reason: string };

function UploadCard({ onChanged }: { onChanged: () => Promise<unknown> }) {
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [received, setReceived] = useState<{ bytes: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Fayl xeshi qayta hisoblanmasin (davom ettirishda)
  const hashRef = useRef<{ key: string; sha256: string } | null>(null);

  const pick = (picked: File | null) => {
    setFile(picked);
    setPhase({ kind: "idle" });
    setReceived(null);
    const found = picked?.name.match(/(\d+\.\d+\.\d+)/)?.[1];
    if (found) setVersion(found);
  };

  const error = !file ? null : !FILE_NAME.test(file.name) ? "Fayl nomi .exe bilan tugasin (lotin harf, raqam, - _ . ( ) belgilari)" : !VERSION.test(version) ? "Versiya formati: 1.2.3" : null;
  const busy = phase.kind === "hashing" || phase.kind === "uploading" || phase.kind === "completing";

  const fileSha256 = async (target: File, signal: AbortSignal) => {
    const key = `${target.name}:${target.size}:${target.lastModified}`;
    if (hashRef.current?.key === key) return hashRef.current.sha256;
    const hash = new Sha256();
    for (let offset = 0; offset < target.size; offset += CHUNK_BYTES) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      hash.update(new Uint8Array(await target.slice(offset, offset + CHUNK_BYTES).arrayBuffer()));
      setPhase({ kind: "hashing", done: Math.min(target.size, offset + CHUNK_BYTES) });
    }
    const sha256 = hash.hex();
    hashRef.current = { key, sha256 };
    return sha256;
  };

  const upload = async () => {
    if (!file || error) return;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setPhase({ kind: "hashing", done: 0 });
      const sha256 = await fileSha256(file, controller.signal);
      // Shu versiya shu fayl bilan yuklanayotgan bo'lsa — server o'sha sessiyani qaytaradi (davom ettirish)
      const { upload: session } = await api.post<{ upload: ReleaseUpload }>(UPLOADS_PATH, { version, fileName: file.name, size: file.size, sha256, chunkSize: CHUNK_BYTES });
      setReceived({ bytes: session.receivedBytes, total: file.size });
      setPhase({ kind: "uploading" });
      const have = new Set(session.receivedChunks);
      const queue = Array.from({ length: session.totalChunks }, (_, index) => index).filter((index) => !have.has(index));
      const worker = async () => {
        for (let index = queue.shift(); index !== undefined; index = queue.shift()) {
          const blob = file.slice(index * CHUNK_BYTES, Math.min(file.size, (index + 1) * CHUNK_BYTES));
          for (let attempt = 1; ; attempt++) {
            try {
              const bytes = await sendChunk(session.id, index, blob, controller.signal);
              setReceived((current) => ({ bytes: Math.max(current?.bytes ?? 0, bytes), total: file.size }));
              break;
            } catch (err) {
              if (controller.signal.aborted || attempt >= MAX_ATTEMPTS || !retryable(err)) throw err;
              await sleep(Math.min(30_000, 1000 * 2 ** (attempt - 1)));
            }
          }
        }
      };
      await Promise.all(Array.from({ length: PARALLEL_CHUNKS }, worker));
      setPhase({ kind: "completing" });
      const { release } = await api.post<{ release: DesktopRelease }>(`${UPLOADS_PATH}/${session.id}/complete`);
      toast.success(`${release.version} yuklandi va SHA-256 tekshirildi — izoh yozib, e'lon qiling`);
      setFile(null);
      setVersion("");
      setReceived(null);
      setPhase({ kind: "idle" });
    } catch (err) {
      const reason = controller.signal.aborted ? "To'xtatildi" : errorMessage(err);
      setPhase({ kind: "paused", reason });
      if (!controller.signal.aborted) toast.error(reason);
    } finally {
      abortRef.current = null;
      await onChanged();
    }
  };

  const hashedPercent = phase.kind === "hashing" && file ? percent(phase.done, file.size) : 0;
  const sentPercent = received ? percent(received.bytes, received.total) : 0;

  return (
    <Card className="bg-white/5 border-white/8">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-white/80 flex items-center gap-2">
          <Upload className="h-4 w-4 text-primary" />
          O'rnatuvchini yuklash
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="release-file" className="text-xs text-white/50">NSIS o'rnatuvchi (.exe)</Label>
            <Input
              id="release-file"
              type="file"
              accept=".exe,application/vnd.microsoft.portable-executable,application/octet-stream"
              disabled={busy}
              onChange={(event) => pick(event.target.files?.[0] ?? null)}
              className={cn(inputClass, "file:text-white/70")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="release-version" className="text-xs text-white/50">Versiya</Label>
            <Input id="release-version" value={version} placeholder="0.2.1" disabled={busy} onChange={(event) => setVersion(event.target.value.trim())} className={inputClass} />
          </div>
        </div>
        {file && (
          <p className="text-xs text-white/50">
            {file.name} · {megabytes(file.size)}
            {error && <span className="text-red-400"> — {error}</span>}
          </p>
        )}
        {(phase.kind === "hashing" || received) && (
          <div className="space-y-1">
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className={cn("h-full transition-[width]", phase.kind === "hashing" ? "bg-white/40" : "bg-primary")}
                style={{ width: `${phase.kind === "hashing" ? hashedPercent : sentPercent}%` }}
              />
            </div>
            <p className="text-xs text-white/50 tabular-nums">
              {phase.kind === "hashing" && `Fayl tekshirilmoqda (SHA-256): ${hashedPercent}%`}
              {phase.kind !== "hashing" && received && `Yuklangan: ${megabytes(received.bytes)} / ${megabytes(received.total)} (${sentPercent}%)`}
              {phase.kind === "completing" && " — serverda SHA-256 solishtirilmoqda…"}
            </p>
          </div>
        )}
        {phase.kind === "paused" && (
          <p className="text-xs text-amber-300">
            {phase.reason}. Serverda qabul qilingan qism saqlanadi — «Davom ettirish» bosing (sahifa yangilangan bo'lsa, shu faylni qayta tanlang).
          </p>
        )}
        <div className="flex justify-end gap-2">
          {busy && phase.kind !== "completing" && (
            <Button variant="secondary" className="gap-2" onClick={() => abortRef.current?.abort()}>
              <Pause className="h-4 w-4" /> To'xtatish
            </Button>
          )}
          <Button onClick={() => { void upload(); }} disabled={!file || !!error || busy} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {phase.kind === "paused" ? "Davom ettirish" : "Yuklash"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReleaseRow({ release }: { release: DesktopRelease }) {
  const [draft, setDraft] = useState<{ notes: string; minVersion: string } | null>(null);
  const invalidate = { invalidate: [RELEASES_PATH] };
  const patch = useApiMutation(
    (body: { notes: string | null; minVersion: string | null }) => api.patch<{ release: DesktopRelease }>(`${RELEASES_PATH}/${release.id}`, body),
    invalidate,
  );
  const publish = useApiMutation(
    (signature: string) => api.post<{ release: DesktopRelease }>(`${RELEASES_PATH}/${release.id}/publish`, { signature }),
    invalidate,
  );
  const archive = useApiMutation(() => api.post<{ release: DesktopRelease }>(`${RELEASES_PATH}/${release.id}/archive`), invalidate);
  const abort = useApiMutation(() => api.post(`${UPLOADS_PATH}/${release.id}/abort`), invalidate);
  const busy = patch.isPending || publish.isPending || archive.isPending || abort.isPending;
  const form = draft ?? { notes: release.notes ?? "", minVersion: release.minVersion ?? "" };
  const minVersionError = form.minVersion && !VERSION.test(form.minVersion) ? "Format: 1.2.3" : null;
  const incomplete = release.status === "uploading" || release.status === "failed";

  const run = async (action: () => Promise<unknown>, message: string) => {
    try {
      await action();
      setDraft(null);
      toast.success(message);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const handlePublish = () => {
    // Imzo reliz tuzuvchi kompyuterida: `node apps/desktop/scripts/release-sign.mjs sign <o'rnatuvchi.exe> <versiya>` — kassalar
    // imzosiz yoki noto'g'ri imzoli yangilanishni o'rnatmaydi
    const signature = window.prompt(`${release.version} relizining imzosi (release-sign.mjs sign natijasidagi "Imzo"):`)?.trim();
    if (!signature) return;
    if (!window.confirm(`${release.version} e'lon qilinsinmi? Barcha kassalarga yangilanish taklif qilinadi.`)) return;
    void run(() => publish.mutateAsync(signature), `${release.version} e'lon qilindi`);
  };

  const handleAbort = () => {
    if (!window.confirm(`${release.version} yuklashi bekor qilinsinmi? Serverdagi qism o'chiriladi.`)) return;
    void run(() => abort.mutateAsync(), "Yuklash bekor qilindi");
  };

  const status = STATUS[release.status];
  const expected = release.expectedSize ?? release.size;
  const receivedBytes = release.receivedBytes ?? 0;
  return (
    <div className="p-3 rounded-xl bg-white/4 border border-white/8 space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-base font-semibold text-white tabular-nums">{release.version}</span>
        <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border", status.className)}>{status.label}</span>
        <span className="text-xs text-white/40">{release.fileName} · {megabytes(expected)}</span>
        <span className="ml-auto flex gap-2">
          {!incomplete && release.status !== "published" && (
            <Button size="sm" onClick={handlePublish} disabled={busy} className="gap-1.5">
              <Rocket className="h-3.5 w-3.5" /> E'lon qilish
            </Button>
          )}
          {!incomplete && release.status !== "archived" && (
            <Button size="sm" variant="secondary" disabled={busy} className="gap-1.5" onClick={() => { void run(() => archive.mutateAsync(), `${release.version} arxivga o'tdi`); }}>
              <Archive className="h-3.5 w-3.5" /> Arxiv
            </Button>
          )}
          {incomplete && (
            <Button size="sm" variant="secondary" disabled={busy} className="gap-1.5" onClick={handleAbort}>
              <Trash2 className="h-3.5 w-3.5" /> {release.status === "failed" ? "O'chirish" : "Bekor qilish"}
            </Button>
          )}
        </span>
      </div>

      {release.status === "uploading" && (
        <div className="space-y-1">
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-sky-400" style={{ width: `${percent(receivedBytes, expected)}%` }} />
          </div>
          <p className="text-xs text-white/50 tabular-nums">
            Qabul qilingan: {megabytes(receivedBytes)} / {megabytes(expected)} ({percent(receivedBytes, expected)}%). Davom ettirish uchun yuqorida shu faylni
            ({release.fileName}) va {release.version} versiyasini tanlab «Yuklash» bosing.
          </p>
        </div>
      )}
      {release.status === "failed" && release.error && <p className="text-xs text-red-300">{release.error}</p>}

      {!incomplete && (
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <div className="min-w-0">
            <dt className="text-white/40">SHA-256</dt>
            <dd className="font-mono text-white/70 break-all">{release.sha256}</dd>
          </div>
          <div>
            <dt className="text-white/40">Yukladi</dt>
            <dd className="text-white/70">{release.uploadedByName ?? "—"} · {fmtDate(release.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-white/40">E'lon qilingan</dt>
            <dd className="text-white/70">{fmtDate(release.publishedAt)}</dd>
          </div>
        </dl>
      )}

      {release.status !== "failed" && (
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-2 items-end">
          <div className="space-y-1">
            <Label htmlFor={`notes-${release.id}`} className="text-xs text-white/50">Izoh (kassada ko'rinadi)</Label>
            <Input id={`notes-${release.id}`} value={form.notes} maxLength={2000} placeholder="Nima o'zgardi" onChange={(event) => setDraft({ ...form, notes: event.target.value })} className={inputClass} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`min-${release.id}`} className="text-xs text-white/50">Majburiy (bundan eski)</Label>
            <Input id={`min-${release.id}`} value={form.minVersion} placeholder="0.1.0" onChange={(event) => setDraft({ ...form, minVersion: event.target.value.trim() })} className={inputClass} />
          </div>
          <Button
            variant="secondary"
            disabled={!draft || busy || !!minVersionError}
            className="gap-1.5"
            onClick={() => { void run(() => patch.mutateAsync({ notes: form.notes.trim() || null, minVersion: form.minVersion || null }), "Saqlandi"); }}
          >
            <Save className="h-3.5 w-3.5" /> Saqlash
          </Button>
        </div>
      )}
      {minVersionError && <p className="text-xs text-red-400">Majburiy versiya — {minVersionError}</p>}
    </div>
  );
}

export default function AdminDesktopReleases() {
  const releasesQuery = useApiQuery<{ releases: DesktopRelease[] }>(RELEASES_PATH);
  const releases = releasesQuery.data?.releases;

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <MonitorDown className="h-6 w-6 text-primary" />
          Desktop kassa
        </h1>
        <p className="text-sm text-white/40 mt-0.5">
          BUM POS KASSA o'rnatuvchisi: yuklang (uzilsa davom etadi), izoh yozing va e'lon qiling — kassalar yangilanishni o'zi
          yuklab oladi va SHA-256 ni tekshiradi
        </p>
      </div>

      <UploadCard onChanged={() => releasesQuery.refetch()} />

      <Card className="bg-white/5 border-white/8">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-white/80">Relizlar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {releasesQuery.error ? (
            <p className="text-sm text-white/40">{errorMessage(releasesQuery.error)}</p>
          ) : !releases ? (
            <Skeleton className="h-24 w-full bg-white/5" />
          ) : releases.length === 0 ? (
            <p className="text-sm text-white/40">Hali reliz yuklanmagan</p>
          ) : (
            releases.map((release) => <ReleaseRow key={release.id} release={release} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}
