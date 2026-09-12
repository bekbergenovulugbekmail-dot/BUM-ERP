/**
 * Desktop kassa relizlari — `GET/POST /api/platform/desktop-releases`, `PATCH …/:id`, `POST …/:id/publish|archive`.
 * O'rnatuvchi (.exe) brauzerdan to'g'ridan-to'g'ri API'ga oqim bilan yuklanadi (bazada bo'laklab saqlanadi, SHA-256
 * serverda hisoblanadi). E'lon qilingan reliz kassalarga «Yangilanish» sifatida chiqadi; qurilma yuklab olib SHA-256 ni
 * tekshiradi va o'rnatadi. Bir vaqtda bitta reliz e'lon qilingan — yangisi e'lon qilinsa oldingisi arxivga o'tadi.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Archive, Loader2, MonitorDown, Rocket, Save, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { ApiError, api, apiUrl, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { cn } from "@/lib/utils.ts";
import type { DesktopRelease } from "../_lib/types.ts";

const RELEASES_PATH = "/api/platform/desktop-releases";
const VERSION = /^\d{1,4}\.\d{1,5}\.\d{1,6}$/;
const FILE_NAME = /^[\w .()-]+\.exe$/i;
const inputClass = "bg-white/5 border-white/10 text-white placeholder:text-white/30";

const STATUS: Record<DesktopRelease["status"], { label: string; className: string }> = {
  draft: { label: "Qoralama", className: "bg-amber-400/10 text-amber-300 border-amber-400/30" },
  published: { label: "E'lon qilingan", className: "bg-emerald-400/10 text-emerald-300 border-emerald-400/30" },
  archived: { label: "Arxiv", className: "bg-white/5 text-white/50 border-white/10" },
};

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const fmtDate = (value: string | null) =>
  value ? new Date(value).toLocaleString("uz-UZ", { dateStyle: "short", timeStyle: "short" }) : "—";

type UploadInput = { file: File; version: string; onProgress: (ratio: number) => void };

/** `fetch` yuklash jarayonini ko'rsatmaydi — XHR (sessiya cookie bilan). */
function uploadInstaller({ file, version, onProgress }: UploadInput): Promise<DesktopRelease> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl(RELEASES_PATH, { version, fileName: file.name }));
    xhr.withCredentials = true;
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      type UploadResponse = { release?: DesktopRelease; code?: string; message?: string };
      let payload: UploadResponse | null;
      try {
        payload = JSON.parse(xhr.responseText) as UploadResponse;
      } catch {
        payload = null;
      }
      if (xhr.status === 201 && payload?.release) resolve(payload.release);
      else reject(new ApiError(xhr.status, payload?.code ?? "BAD_REQUEST", payload?.message ?? `Yuklanmadi (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, "NETWORK", "Server bilan aloqa uzildi — qayta urinib ko'ring"));
    xhr.send(file);
  });
}

function UploadCard() {
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const upload = useApiMutation(uploadInstaller, { invalidate: [RELEASES_PATH] });

  const pick = (picked: File | null) => {
    setFile(picked);
    // Nomidagi versiya (BUM-POS-KASSA-Setup-0.2.0.exe) avtomatik
    const found = picked?.name.match(/(\d+\.\d+\.\d+)/)?.[1];
    if (found) setVersion(found);
  };

  const error = !file
    ? null
    : !FILE_NAME.test(file.name)
      ? "Fayl nomi .exe bilan tugasin (lotin harf, raqam, - _ . ( ) belgilari)"
      : !VERSION.test(version)
        ? "Versiya formati: 1.2.3"
        : null;

  const handleUpload = async () => {
    if (!file || error) return;
    setProgress(0);
    try {
      const release = await upload.mutateAsync({ file, version, onProgress: setProgress });
      toast.success(`${release.version} yuklandi — tekshirib, e'lon qiling`);
      setFile(null);
      setVersion("");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setProgress(null);
    }
  };

  return (
    <Card className="bg-white/5 border-white/8">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-white/80 flex items-center gap-2">
          <Upload className="h-4 w-4 text-primary" />
          Yangi o'rnatuvchini yuklash
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
              disabled={upload.isPending}
              onChange={(event) => pick(event.target.files?.[0] ?? null)}
              className={cn(inputClass, "file:text-white/70")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="release-version" className="text-xs text-white/50">Versiya</Label>
            <Input
              id="release-version"
              value={version}
              placeholder="0.2.0"
              disabled={upload.isPending}
              onChange={(event) => setVersion(event.target.value.trim())}
              className={inputClass}
            />
          </div>
        </div>
        {file && (
          <p className="text-xs text-white/50">
            {file.name} · {megabytes(file.size)}
            {error && <span className="text-red-400"> — {error}</span>}
          </p>
        )}
        {progress !== null && (
          <div className="space-y-1">
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="text-xs text-white/50 tabular-nums">
              {progress < 1 ? `Yuklanmoqda: ${Math.round(progress * 100)}%` : "Serverda saqlanmoqda va SHA-256 hisoblanmoqda…"}
            </p>
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={() => { void handleUpload(); }} disabled={!file || !!error || upload.isPending} className="gap-2">
            {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Yuklash
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
  const publish = useApiMutation(() => api.post<{ release: DesktopRelease }>(`${RELEASES_PATH}/${release.id}/publish`), invalidate);
  const archive = useApiMutation(() => api.post<{ release: DesktopRelease }>(`${RELEASES_PATH}/${release.id}/archive`), invalidate);
  const busy = patch.isPending || publish.isPending || archive.isPending;
  const form = draft ?? { notes: release.notes ?? "", minVersion: release.minVersion ?? "" };
  const minVersionError = form.minVersion && !VERSION.test(form.minVersion) ? "Format: 1.2.3" : null;

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
    if (!window.confirm(`${release.version} e'lon qilinsinmi? Barcha kassalarga yangilanish taklif qilinadi.`)) return;
    void run(() => publish.mutateAsync(), `${release.version} e'lon qilindi`);
  };

  const status = STATUS[release.status];
  return (
    <div className="p-3 rounded-xl bg-white/4 border border-white/8 space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-base font-semibold text-white tabular-nums">{release.version}</span>
        <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border", status.className)}>{status.label}</span>
        <span className="text-xs text-white/40">{release.fileName} · {megabytes(release.size)}</span>
        <span className="ml-auto flex gap-2">
          {release.status !== "published" && (
            <Button size="sm" onClick={handlePublish} disabled={busy} className="gap-1.5">
              <Rocket className="h-3.5 w-3.5" /> E'lon qilish
            </Button>
          )}
          {release.status !== "archived" && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              className="gap-1.5"
              onClick={() => { void run(() => archive.mutateAsync(), `${release.version} arxivga o'tdi`); }}
            >
              <Archive className="h-3.5 w-3.5" /> Arxiv
            </Button>
          )}
        </span>
      </div>
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
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-2 items-end">
        <div className="space-y-1">
          <Label htmlFor={`notes-${release.id}`} className="text-xs text-white/50">Izoh (kassada ko'rinadi)</Label>
          <Input
            id={`notes-${release.id}`}
            value={form.notes}
            maxLength={2000}
            placeholder="Nima o'zgardi"
            onChange={(event) => setDraft({ ...form, notes: event.target.value })}
            className={inputClass}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`min-${release.id}`} className="text-xs text-white/50">Majburiy (bundan eski)</Label>
          <Input
            id={`min-${release.id}`}
            value={form.minVersion}
            placeholder="0.1.0"
            onChange={(event) => setDraft({ ...form, minVersion: event.target.value.trim() })}
            className={inputClass}
          />
        </div>
        <Button
          variant="secondary"
          disabled={!draft || busy || !!minVersionError}
          className="gap-1.5"
          onClick={() => {
            void run(() => patch.mutateAsync({ notes: form.notes.trim() || null, minVersion: form.minVersion || null }), "Saqlandi");
          }}
        >
          <Save className="h-3.5 w-3.5" /> Saqlash
        </Button>
      </div>
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
          BUM POS KASSA o'rnatuvchisi: yuklang, izoh yozing va e'lon qiling — kassalar yangilanishni o'zi yuklab oladi va
          SHA-256 ni tekshiradi
        </p>
      </div>

      <UploadCard />

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
