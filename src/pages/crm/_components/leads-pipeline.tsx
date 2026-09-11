import { useState } from "react";
import { toast } from "sonner";
import { Plus, GripVertical, User, Phone, Building2, Star } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation, useApiQuery } from "@/lib/query.ts";
import { num, type Lead, type LeadSource, type LeadStage, type LeadStats, type SalesRepOption } from "../_lib/types.ts";

const fmt = (n: number) => new Intl.NumberFormat("uz-UZ").format(Math.round(n));

const STAGES = [
  { key: "new", label: "Yangi", color: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", dot: "bg-slate-400" },
  { key: "contacted", label: "Muloqot", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300", dot: "bg-blue-400" },
  { key: "qualified", label: "Malumot tasdiqlandi", color: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", dot: "bg-violet-400" },
  { key: "proposal", label: "Taklif yuborildi", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300", dot: "bg-amber-400" },
  { key: "won", label: "Yutildi", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", dot: "bg-emerald-400" },
  { key: "lost", label: "Yo'qotildi", color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400", dot: "bg-rose-400" },
] as const satisfies readonly { key: LeadStage; label: string; color: string; dot: string }[];

const SOURCES = ["website", "referral", "social", "cold_call", "exhibition", "other"] as const satisfies readonly LeadSource[];
const SOURCE_LABELS: Record<LeadSource, string> = {
  website: "Veb-sayt", referral: "Tavsiya", social: "Ijtimoiy tarmoq",
  cold_call: "Sovuq qo'ng'iroq", exhibition: "Ko'rgazma", other: "Boshqa",
};

const emptyForm = () => ({
  name: "", companyName: "", phone: "", email: "",
  source: "website" as LeadSource,
  estimatedValue: "", salesRepId: "", expectedCloseDate: "", notes: "",
});

type StageChangeInput = { id: string; stage: LeadStage; lostReason?: string; convertToCustomer?: boolean };

export default function LeadsPipeline() {
  const allLeads = useApiQuery<{ leads: Lead[] }>("/api/crm/leads", { limit: 200 }).data?.leads;
  const stats = useApiQuery<LeadStats>("/api/crm/leads/stats").data;
  const salesReps = useApiQuery<{ salesReps: SalesRepOption[] }>("/api/crm/sales-reps").data?.salesReps;

  const createLead = useApiMutation((body: Record<string, unknown>) => api.post("/api/crm/leads", body));
  const changeStage = useApiMutation(({ id, ...body }: StageChangeInput) => api.post(`/api/crm/leads/${id}/stage`, body));
  const removeLead = useApiMutation((id: string) => api.delete(`/api/crm/leads/${id}`));

  const [createOpen, setCreateOpen] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [hoveredStage, setHoveredStage] = useState<string | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  // "Yutildi" va "Yo'qotildi" alohida tasdiqlanadi: mijozga aylantirish / yo'qotish sababi
  const [stageChange, setStageChange] = useState<{ lead: Lead; stage: "won" | "lost" } | null>(null);
  const [lostReason, setLostReason] = useState("");
  const [convertToCustomer, setConvertToCustomer] = useState(true);
  const [form, setForm] = useState(emptyForm);

  const selectedLead = allLeads?.find((l) => l.id === selectedLeadId) ?? null;
  const stageCount = (stage: LeadStage) => stats?.byStage.find((s) => s.stage === stage)?.count ?? 0;

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error("Ism kiritilishi shart"); return; }
    try {
      await createLead.mutateAsync({
        name: form.name,
        companyName: form.companyName || null,
        phone: form.phone || null,
        email: form.email || null,
        source: form.source,
        estimatedValue: form.estimatedValue || null,
        salesRepId: form.salesRepId && form.salesRepId !== "none" ? form.salesRepId : null,
        expectedCloseDate: form.expectedCloseDate || null,
        notes: form.notes || null,
      });
      toast.success("Lead qo'shildi");
      setCreateOpen(false);
      setForm(emptyForm());
    } catch (e) { toast.error(errorMessage(e)); }
  };

  const requestStage = async (lead: Lead, stage: LeadStage) => {
    if (lead.stage === stage) return;
    if (stage === "won" || stage === "lost") {
      setLostReason("");
      setConvertToCustomer(!lead.customerId);
      setSelectedLeadId(null);
      setStageChange({ lead, stage });
      return;
    }
    try { await changeStage.mutateAsync({ id: lead.id, stage }); }
    catch (e) { toast.error(errorMessage(e)); }
  };

  const confirmStageChange = async () => {
    if (!stageChange) return;
    const { lead, stage } = stageChange;
    if (stage === "lost" && !lostReason.trim()) { toast.error("Yo'qotish sababini kiriting"); return; }
    try {
      await changeStage.mutateAsync(
        stage === "won"
          ? { id: lead.id, stage, convertToCustomer: convertToCustomer && !lead.customerId }
          : { id: lead.id, stage, lostReason: lostReason.trim() },
      );
      toast.success(stage === "won" ? "Lead yutildi" : "Lead yo'qotildi deb belgilandi");
      setStageChange(null);
    } catch (e) { toast.error(errorMessage(e)); }
  };

  const handleDrop = (stage: LeadStage) => {
    const lead = allLeads?.find((l) => l.id === draggedId);
    setDraggedId(null);
    setHoveredStage(null);
    if (lead) void requestStage(lead, stage);
  };

  const handleRemove = async (id: string) => {
    try {
      await removeLead.mutateAsync(id);
      setSelectedLeadId(null);
      toast.success("O'chirildi");
    } catch (e) { toast.error(errorMessage(e)); }
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
            { label: "Faol", value: stageCount("new") + stageCount("contacted") + stageCount("qualified") + stageCount("proposal") },
            { label: "Yutilgan", value: stageCount("won") },
            { label: "Taxminiy qiymat", value: fmt(num(stats.openValue)) + " so'm" },
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
          const stageValue = stageLeads.reduce((s, l) => s + num(l.estimatedValue), 0);
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
                    key={lead.id}
                    draggable
                    onDragStart={() => setDraggedId(lead.id)}
                    onDragEnd={() => { setDraggedId(null); setHoveredStage(null); }}
                    onClick={() => setSelectedLeadId(lead.id)}
                    className={cn(
                      "bg-card border border-border rounded-xl p-3 cursor-grab active:cursor-grabbing hover:border-primary/30 transition-all",
                      draggedId === lead.id && "opacity-50"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{lead.name}</p>
                        {lead.companyName && <p className="text-xs text-muted-foreground truncate">{lead.companyName}</p>}
                        {num(lead.estimatedValue) > 0 && (
                          <p className="text-xs font-semibold text-primary mt-1">{fmt(num(lead.estimatedValue))} so'm</p>
                        )}
                        <div className="flex items-center gap-1 mt-1.5">
                          <span className="text-[10px] bg-muted rounded px-1 py-0.5">{SOURCE_LABELS[lead.source]}</span>
                          {lead.salesRepName && <span className="text-[10px] text-muted-foreground truncate">{lead.salesRepName}</span>}
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
        <Dialog open onOpenChange={(o) => !o && setSelectedLeadId(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <User className="h-4 w-4" />
                {selectedLead.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              {selectedLead.companyName && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" />
                  {selectedLead.companyName}
                </div>
              )}
              {selectedLead.phone && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" />
                  {selectedLead.phone}
                </div>
              )}
              {num(selectedLead.estimatedValue) > 0 && (
                <div className="flex items-center gap-2">
                  <Star className="h-3.5 w-3.5 text-amber-500" />
                  <span className="font-semibold">{fmt(num(selectedLead.estimatedValue))} so'm</span>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-1">Bosqich o'zgartirish</p>
                <div className="flex flex-wrap gap-1.5">
                  {STAGES.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => void requestStage(selectedLead, s.key)}
                      disabled={changeStage.isPending}
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
              {selectedLead.stage === "lost" && selectedLead.lostReason && (
                <p className="text-rose-600 dark:text-rose-400 bg-rose-500/10 rounded-lg p-2">Sabab: {selectedLead.lostReason}</p>
              )}
              {selectedLead.notes && (
                <p className="text-muted-foreground bg-muted/40 rounded-lg p-2">{selectedLead.notes}</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="secondary" className="text-destructive" onClick={() => void handleRemove(selectedLead.id)}>O'chirish</Button>
              <Button onClick={() => setSelectedLeadId(null)}>Yopish</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Won / lost confirmation */}
      {stageChange && (
        <Dialog open onOpenChange={(o) => !o && setStageChange(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{stageChange.stage === "won" ? "Lead yutildi" : "Lead yo'qotildi"}: {stageChange.lead.name}</DialogTitle>
            </DialogHeader>
            {stageChange.stage === "won" ? (
              stageChange.lead.customerId ? (
                <p className="text-sm text-muted-foreground">Lead allaqachon mijozga bog'langan.</p>
              ) : (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={convertToCustomer}
                    onChange={(e) => setConvertToCustomer(e.target.checked)}
                  />
                  Leaddan yangi mijoz yaratish
                </label>
              )
            ) : (
              <div>
                <Label>Yo'qotish sababi *</Label>
                <Textarea rows={3} value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="Narx to'g'ri kelmadi..." />
              </div>
            )}
            <DialogFooter>
              <Button variant="secondary" onClick={() => setStageChange(null)}>Bekor</Button>
              <Button onClick={() => void confirmStageChange()} disabled={changeStage.isPending}>
                {changeStage.isPending ? "..." : "Tasdiqlash"}
              </Button>
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
                  <Input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="OOO Fayz" />
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
                  <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v as LeadSource })}>
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
                      {salesReps?.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
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
              <Button onClick={handleCreate} disabled={createLead.isPending}>{createLead.isPending ? "..." : "Qo'shish"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
