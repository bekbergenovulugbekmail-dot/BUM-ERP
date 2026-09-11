/**
 * Kompaniya ma'lumotlari — `GET /api/company`, `PATCH /api/company` (`company.manage`).
 * Davlat — ISO 2 harfli kod (API talabi), bo'sh maydonlar serverda NULL bo'ladi.
 */
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Building2, Save } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form.tsx";
import { api, errorMessage } from "@/lib/api.ts";
import { useApiMutation } from "@/lib/query.ts";
import { useActiveCompany, usePermissions } from "@/hooks/use-company.ts";

const schema = z.object({
  name: z.string().trim().min(1, "Kompaniya nomi shart").max(200),
  legalName: z.string().max(300),
  taxId: z.string().max(32),
  phone: z.string().max(20),
  email: z.union([z.literal(""), z.email("Email noto'g'ri")]),
  website: z.string().max(255),
  address: z.string().max(1000),
  city: z.string().max(100),
  country: z.string().length(2),
  currency: z.string().length(3),
});
type FormData = z.infer<typeof schema>;

const CURRENCIES = ["UZS", "USD", "EUR", "RUB", "KZT"];
const COUNTRIES = [
  { code: "UZ", name: "O'zbekiston" },
  { code: "RU", name: "Rossiya" },
  { code: "KZ", name: "Qozog'iston" },
  { code: "KG", name: "Qirg'iziston" },
  { code: "TJ", name: "Tojikiston" },
  { code: "TM", name: "Turkmaniston" },
];

const EMPTY: FormData = {
  name: "", legalName: "", taxId: "", phone: "", email: "", website: "", address: "", city: "", country: "UZ", currency: "UZS",
};

export default function CompanySection() {
  const { data, error } = useActiveCompany();
  const company = data?.company;
  const { can } = usePermissions();
  const canManage = can("company.manage");

  // Standart: barcha ko'rinib turgan so'rovlar yangilanadi (/me dagi kompaniya nomi ham)
  const updateCompany = useApiMutation((patch: Omit<FormData, "email"> & { email: string | null }) =>
    api.patch("/api/company", patch),
  );

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
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

  const onSubmit = async (values: FormData) => {
    try {
      await updateCompany.mutateAsync({ ...values, email: values.email.trim() || null });
      toast.success("Kompaniya ma'lumotlari saqlandi");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (error) {
    return <div className="text-sm text-muted-foreground p-8 text-center">{errorMessage(error)}</div>;
  }
  if (!company) return <Skeleton className="h-96 rounded-2xl" />;

  const countries = COUNTRIES.some((c) => c.code === company.country)
    ? COUNTRIES
    : [...COUNTRIES, { code: company.country, name: company.country }];

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center gap-3 pb-2 border-b border-border">
        <div className="h-10 w-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
          <Building2 className="h-5 w-5 text-indigo-500" />
        </div>
        <div>
          <p className="font-semibold">Kompaniya ma'lumotlari</p>
          <p className="text-xs text-muted-foreground">
            {canManage ? "ERP tizimida ko'rsatiladigan asosiy ma'lumotlar" : "Faqat ko'rish — o'zgartirish uchun ruxsat yo'q"}
          </p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <fieldset disabled={!canManage} className="grid grid-cols-2 gap-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Kompaniya nomi *</FormLabel>
                <FormControl><Input {...field} placeholder="Mening Kompaniyam LLC" /></FormControl>
                <FormMessage />
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
                <FormControl><Input {...field} placeholder="+998901234567" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input {...field} placeholder="info@company.com" /></FormControl>
                <FormMessage />
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
                <Select value={field.value} onValueChange={field.onChange} disabled={!canManage}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{countries.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </FormItem>
            )} />
            <FormField control={form.control} name="currency" render={({ field }) => (
              <FormItem>
                <FormLabel>Asosiy valyuta</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={!canManage}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </FormItem>
            )} />
          </fieldset>
          {canManage && (
            <Button type="submit" disabled={updateCompany.isPending}>
              <Save className="h-4 w-4 mr-2" />
              {updateCompany.isPending ? "Saqlanmoqda..." : "Saqlash"}
            </Button>
          )}
        </form>
      </Form>
      {/* Eski "Ko'p tenantli migratsiya" kartasi olib tashlandi — ma'lumot ko'chirish server CLI orqali (PHASE 15) */}
    </div>
  );
}
