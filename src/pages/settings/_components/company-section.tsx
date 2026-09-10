import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Building2, Save, DatabaseZap } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form.tsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card.tsx";

const schema = z.object({
  name: z.string().min(1, "Kompaniya nomi shart"),
  legalName: z.string().optional(),
  taxId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  website: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().min(1),
  currency: z.string().min(1),
});
type FormData = z.infer<typeof schema>;

const CURRENCIES = ["UZS", "USD", "EUR", "RUB", "KZT"];
const COUNTRIES = ["Uzbekiston", "Rossiya", "Qozog'iston", "Qirg'iziston", "Tojikiston", "Turkmaniston"];

export default function CompanySection() {
  const company = useQuery(api.admin.getCompany);
  const upsertCompany = useMutation(api.admin.upsertCompany);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", legalName: "", taxId: "", phone: "", email: "", website: "", address: "", city: "", country: "Uzbekiston", currency: "UZS" },
  });

  useEffect(() => {
    if (company) {
      form.reset({
        name: company.name,
        legalName: company.legalName ?? "",
        taxId: company.taxId ?? "",
        phone: company.phone ?? "",
        email: company.email ?? "",
        website: company.website ?? "",
        address: company.address ?? "",
        city: company.city ?? "",
        country: company.country,
        currency: company.currency,
      });
    }
  }, [company, form]);

  const onSubmit = async (data: FormData) => {
    try {
      await upsertCompany(data);
      toast.success("Kompaniya ma'lumotlari saqlandi");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Xatolik");
    }
  };

  if (company === undefined) return <Skeleton className="h-96 rounded-2xl" />;

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center gap-3 pb-2 border-b border-border">
        <div className="h-10 w-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
          <Building2 className="h-5 w-5 text-indigo-500" />
        </div>
        <div>
          <p className="font-semibold">Kompaniya ma'lumotlari</p>
          <p className="text-xs text-muted-foreground">ERP tizimida ko'rsatiladigan asosiy ma'lumotlar</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Kompaniya nomi *</FormLabel>
                <FormControl><Input {...field} placeholder="Mening Kompaniyam LLC" /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="legalName" render={({ field }) => (
              <FormItem>
                <FormLabel>Yuridik nomi</FormLabel>
                <FormControl><Input {...field} placeholder="OOO «Mening Kompaniyam»" /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="taxId" render={({ field }) => (
              <FormItem>
                <FormLabel>INN / Soliq ID</FormLabel>
                <FormControl><Input {...field} placeholder="123456789" /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="phone" render={({ field }) => (
              <FormItem>
                <FormLabel>Telefon</FormLabel>
                <FormControl><Input {...field} placeholder="+998 90 123 45 67" /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input {...field} placeholder="info@company.com" /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="website" render={({ field }) => (
              <FormItem>
                <FormLabel>Veb-sayt</FormLabel>
                <FormControl><Input {...field} placeholder="https://company.com" /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="address" render={({ field }) => (
              <FormItem>
                <FormLabel>Manzil</FormLabel>
                <FormControl><Input {...field} placeholder="Toshkent, Chilonzor tumani" /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="city" render={({ field }) => (
              <FormItem>
                <FormLabel>Shahar</FormLabel>
                <FormControl><Input {...field} placeholder="Toshkent" /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="country" render={({ field }) => (
              <FormItem>
                <FormLabel>Davlat</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </FormItem>
            )} />
            <FormField control={form.control} name="currency" render={({ field }) => (
              <FormItem>
                <FormLabel>Asosiy valyuta</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </FormItem>
            )} />
          </div>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            <Save className="h-4 w-4 mr-2" />
            {form.formState.isSubmitting ? "Saqlanmoqda..." : "Saqlash"}
          </Button>
        </form>
      </Form>

      {/* One-time migration card */}
      <MigrationCard />
    </div>
  );
}

function MigrationCard() {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const migrate = useMutation(api.companies.migrateExistingDataToTenant);

  const handleMigrate = async () => {
    setLoading(true);
    try {
      const result = await migrate({});
      if (result.companyId) {
        toast.success(`Migratsiya tugadi: ${result.migrated} yozuv yangilandi`);
        setDone(true);
      } else {
        toast.error("Kompaniya topilmadi. Avval kompaniya ma'lumotlarini saqlang.");
      }
    } catch {
      toast.error("Migratsiya xatosi");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-dashed border-warning/50 bg-warning/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <DatabaseZap className="h-4 w-4 text-orange-500" />
          Ko'p tenantli migratsiya
        </CardTitle>
        <CardDescription className="text-xs">
          Mavjud barcha ma'lumotlarni joriy kompaniyaga biriktirish uchun bir marta ishga tushiring.
          Bu operatsiya xavfsiz va qayta-qayta ishlatilishi mumkin.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleMigrate}
          disabled={loading || done}
        >
          <DatabaseZap className="h-4 w-4 mr-1.5" />
          {done ? "Migratsiya bajarildi ✓" : loading ? "Bajarilmoqda..." : "Migratsiyani boshlash"}
        </Button>
      </CardContent>
    </Card>
  );
}
