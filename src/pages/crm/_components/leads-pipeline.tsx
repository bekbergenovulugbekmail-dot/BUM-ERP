import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { Plus, GripVertical, User, Phone, Building2, ChevronRight, Star } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import type { Id } from "@/convex/_generated/dataModel.d.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const STAGES = [
  { key: "new", label: "Yangi", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", dot: "bg-slate-400" },
  { key: "contacted", label: "Muloqot", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", dot: "bg-blue-400" },
  { key: "qualified", label: "Malumot tasdiqlandi", color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", dot: "bg-violet-400" },
  { key: "proposal", label: "Taklif yuborildi", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", dot: "bg-amber-400" },
  { key: "won", label: "Yutildi", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", dot: "bg-emerald-400" },
  { key: "lost", label: "Yo'qotildi", color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400", dot: "bg-rose-400" },
] as const;

const SOURCES = ["website", "referral", "social", "cold_call", "exhibition", "other"] as const;
const SOURCE_LABELS: Record<string, string> = {
  website: "Veb-sayt", referral: "Tavsiya", social: "Ijtimoiy tarmoq",
  cold_call: "Sovuq qo'ng'iroq", exhibition: "Ko'rgazma", other: "Boshqa",
};

export default function LeadsPipeline() {
  const allLeads = useQuery(api.crm.leads.list, { limit: 200 });
  const stats = useQuery(api.crm.leads.getStats, {});
  const salesReps = useQuery(api.crm.salesReps.list, { onlyActive: true });
  const createLead = useMutation(api.crm.leads.create);
  const updateStage = useMutation(api.crm.leads.updateStage);
  const removeLead = useMutation(api.crm.leads.remove);

  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draggedId, setDraggedId] = useState<Id<"leads"> | null>(null);
  const [hoveredStage, setHoveredStage] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<NonNullable<typeof allLeads>[number] | null>(null);

  const [form, setForm] = useState({
    name: "", company: "", phone: "", email: "",
    source: "website" as typeof SOURCES[number],
    estimatedValue: "", salesRepId: "", expectedCloseDate: "", notes: "",
  });

  const handleCreate = async () => {
    if (!form.name) { toast.error("Ism kiritilishi shart"); return; }
    setLoading(true);
    try {
      await createLead({
        name: form.name,
        company: form.company || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        source: form.source,
        estimatedValue: form.estimatedValue ? parseFloat(form.estimatedValue) : undefined,
        salesRepId: form.salesRepId ? form.salesRepId as Id<"salesReps"> : undefined,
        expectedCloseDate: form.expectedCloseDate || undefined,
        notes: form.notes || undefined,
      });
      toast.success("Lead qo'shildi");
      setCreateOpen(false);
      setForm({ name: "", company: "", phone: "", email: "", source: "website", estimatedValue: "", salesRepId: "", expectedCloseDate: "", notes: "" });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Xatolik"); }
    finally { setLoading(false); }
  };

  const handleDrop = async (stage: string) => {
    if (!draggedId || !hoveredStage) return;
    try {
      await updateStage({ id: draggedId, stage: stage as Parameters<typeof updateStage>[0]["stage"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Xatolik"); }
    setDraggedId(null);
    setHoveredStage(null);
  };

  const handleQuickStage = async (id: Id<"leads">, stage: typeof STAGES[number]["key"]) => {
    try { await updateStage({ id, stage }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Xatolik"); }
  };

  if (!allLeads) {
    return <div className="grid grid-cols-3 md:grid-cols-6 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Jami leadlar", value: stats.total },
            { label: "Faol", value: (stats.byStage["new"] ?? 0) + (stats.byStage["contacted"] ?? 0) + (stats.byStage["qualified"] ?? 0) + (stats.byStage["proposal"] ?? 0) },
            { label: "Yutilgan", value: stats.byStage["won"] ?? 0 },
            { label: "Taxminiy qiymat", value: fmt(stats.totalValue) + " so'm" },
          ].map((s) => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-lg font-bold mt-1">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Pipeline (Kanban)</h3>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Yangi lead
        </Button>
      </div>

      {/* Kanban board */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {STAGES.map((stage) => {
          const stageLeads = allLeads.filter((l) => l.stage === stage.key);
          const stageValue = stageLeads.reduce((s, l) => s + (l.estimatedValue ?? 0), 0);
          return (
            <div
              key={stage.key}
              className={cn(
                "flex-shrink-0 w-64 bg-muted/40 rounded-2xl p-3 transition-all border-2",
                hoveredStage === stage.key ? "border-primary/50 bg-primary/5" : "border-transparent"
              )}
              onDragOver={(e) => { e.preventDefault(); setHoveredStage(stage.key); }}
              onDragLeave={() => setHoveredStage(null)}
              onDrop={() => handleDrop(stage.key)}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className={cn("h-2 w-2 rounded-full", stage.dot)} />
                <span className="text-xs font-semibold">{stage.label}</span>
                <span className="ml-auto text-xs bg-background border border-border rounded-full px-1.5 py-0.5">{stageLeads.length}</span>
              </div>
              {stageValue > 0 && (
                <p className="text-xs text-muted-foreground mb-2">{fmt(stageValue)} so'm</p>
              )}
              <div className="space-y-2 min-h-[100px]">
                {stageLeads.map((lead) => (
                  <div
                    key={lead._id}
                    draggable
                    onDragStart={() => setDraggedId(lead._id)}
                    onDragEnd={() => { setDraggedId(null); setHoveredStage(null); }}
                    onClick={() => setSelectedLead(lead)}
                    className={cn(
                      "bg-card border border-border rounded-xl p-3 cursor-grab active:cursor-grabbing hover:border-primary/30 transition-all",
                      draggedId === lead._id && "opacity-50"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{lead.name}</p>
                        {lead.company && <p className="text-xs text-muted-foreground truncate">{lead.company}</p>}
                        {lead.estimatedValue && (
                          <p className="text-xs font-semibold text-primary mt-1">{fmt(lead.estimatedValue)} so'm</p>
                        )}
                        <div className="flex items-center gap-1 mt-1.5">
                          <span className="text-[10px] bg-muted rounded px-1 py-0.5">{SOURCE_LABELS[lead.source]}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Lead detail panel */}
      {selectedLead && (
        <Dialog open onOpenChange={(o) => !o && setSelectedLead(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <User className="h-4 w-4" />
                {selectedLead.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              {selectedLead.company && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" />
                  {selectedLead.company}
                </div>
              )}
              {selectedLead.phone && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" />
                  {selectedLead.phone}
                </div>
              )}
              {selectedLead.estimatedValue && (
                <div className="flex items-center gap-2">
                  <Star className="h-3.5 w-3.5 text-amber-500" />
                  <span className="font-semibold">{fmt(selectedLead.estimatedValue)} so'm</span>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-1">Bosqich o'zgartirish</p>
                <div className="flex flex-wrap gap-1.5">
                  {STAGES.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => handleQuickStage(selectedLead._id, s.key)}
                      className={cn(
                        "text-xs px-2 py-1 rounded-lg border transition-all cursor-pointer",
                        selectedLead.stage === s.key
                          ? "border-primary bg-primary/10 font-semibold"
                          : "border-border hover:border-primary/30"
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              {selectedLead.notes && (
                <p className="text-muted-foreground bg-muted/40 rounded-lg p-2">{selectedLead.notes}</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="secondary" className="text-destructive" onClick={async () => {
                await removeLead({ id: selectedLead._id });
                setSelectedLead(null);
                toast.success("O'chirildi");
              }}>O'chirish</Button>
              <Button onClick={() => setSelectedLead(null)}>Yopish</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Create dialog */}
      {createOpen && (
        <Dialog open onOpenChange={(o) => !o && setCreateOpen(false)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Yangi lead</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label>Ism-familiya *</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Abdullayev Jasur" />
                </div>
                <div>
                  <Label>Kompaniya</Label>
                  <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="OOO Fayz" />
                </div>
                <div>
                  <Label>Telefon</Label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+998 90 ..." />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="example@email.com" />
                </div>
                <div>
                  <Label>Manba</Label>
                  <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v as typeof form.source })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SOURCES.map((s) => <SelectItem key={s} value={s}>{SOURCE_LABELS[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Taxminiy qiymat (so'm)</Label>
                  <Input type="number" min="0" value={form.estimatedValue} onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })} placeholder="0" />
                </div>
                <div>
                  <Label>Savdo vakili</Label>
                  <Select value={form.salesRepId} onValueChange={(v) => setForm({ ...form, salesRepId: v })}>
                    <SelectTrigger><SelectValue placeholder="Tanlang" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {salesReps?.map((r) => <SelectItem key={r._id} value={r._id}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Kutilgan yopilish sanasi</Label>
                  <Input type="date" value={form.expectedCloseDate} onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <Label>Izoh</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setCreateOpen(false)}>Bekor</Button>
              <Button onClick={handleCreate} disabled={loading}>{loading ? "..." : "Qo'shish"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
