/**
 * ERP modullari reyestri — server (modul guard, kompaniya modullari) va web (menyu, sozlamalar, ro'yxatdan o'tish)
 * uchun yagona manba. Faqat mavjud bo'limlar: har kalit o'z API prefikslari va sahifalariga ega.
 *
 * Tizim qismlari (kirish, kompaniya, obuna, bosh sahifa, profil, xavfsizlik, sozlamalar) modul emas — o'chirilmaydi.
 * Modul o'chirilsa ma'lumot o'chirilmaydi: faqat kirish yopiladi (menyu yashiriladi, API MODULE_DISABLED qaytaradi);
 * qayta yoqilganda hammasi avvalgidek.
 */

export const MODULE_KEYS = [
  "products",
  "warehouse",
  "sales",
  "pos",
  "purchase",
  "manufacturing",
  "crm",
  "distribution",
  "delivery",
  "finance",
  "hr",
  "reports",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** O'chirib bo'lmaydigan tizim qismlari (ma'lumot uchun — ular reyestrda modul sifatida yo'q). */
export const CORE_SYSTEM_PARTS = ["auth", "company", "subscription", "dashboard", "profile", "security", "settings"] as const;

export type ModuleDefinition = {
  key: ModuleKey;
  name: string;
  description: string;
  /** lucide-react ikonka nomi. */
  icon: string;
  /** Yoqish uchun avval yoqilgan bo'lishi kerak; o'chirishda — bog'liqlar avval o'chiriladi. */
  dependsOn: readonly ModuleKey[];
  /** Ro'yxatdan o'tishda standart tanlov. */
  defaultEnabled: boolean;
};

export const MODULE_REGISTRY: Record<ModuleKey, ModuleDefinition> = {
  products: {
    key: "products",
    name: "Mahsulotlar",
    description: "Tovar katalogi, kategoriyalar, narxlar va o'lchov birliklari",
    icon: "Package",
    dependsOn: [],
    defaultEnabled: true,
  },
  warehouse: {
    key: "warehouse",
    name: "Ombor",
    description: "Zaxira, kirim-chiqim, ko'chirish va inventarizatsiya",
    icon: "Warehouse",
    dependsOn: ["products"],
    defaultEnabled: true,
  },
  sales: {
    key: "sales",
    name: "Savdo",
    description: "Buyurtmalar, mijoz to'lovlari, qaytarishlar va keshbek",
    icon: "ShoppingCart",
    dependsOn: ["products", "warehouse"],
    defaultEnabled: true,
  },
  pos: {
    key: "pos",
    name: "POS kassa",
    description: "Web kassa, smenalar va BUM POS KASSA desktop qurilmalari",
    icon: "Monitor",
    dependsOn: ["products", "warehouse"],
    defaultEnabled: true,
  },
  purchase: {
    key: "purchase",
    name: "Xarid",
    description: "Ta'minotchilar, xarid buyurtmalari va ularga to'lovlar",
    icon: "ShoppingBag",
    dependsOn: ["products", "warehouse"],
    defaultEnabled: true,
  },
  manufacturing: {
    key: "manufacturing",
    name: "Ishlab chiqarish",
    description: "Retseptlar (BOM) va ishlab chiqarish buyurtmalari",
    icon: "Factory",
    dependsOn: ["products", "warehouse"],
    defaultEnabled: false,
  },
  crm: {
    key: "crm",
    name: "CRM",
    description: "Lidlar, mijozlar bilan ishlash va faoliyatlar",
    icon: "Users",
    dependsOn: [],
    defaultEnabled: true,
  },
  distribution: {
    key: "distribution",
    name: "Distribyutsiya",
    description: "Savdo agentlari, tashriflar va marshrutlar",
    icon: "Truck",
    dependsOn: ["sales"],
    defaultEnabled: true,
  },
  delivery: {
    key: "delivery",
    name: "Dostavka",
    description: "Yetkazmalar, dostavshiklar, xarita va to'lov yig'ish",
    icon: "PackageCheck",
    dependsOn: ["sales"],
    defaultEnabled: true,
  },
  finance: {
    key: "finance",
    name: "Moliya",
    description: "Kassa va bank hisoblari, terminallar, xarajatlar, jurnal",
    icon: "DollarSign",
    dependsOn: [],
    defaultEnabled: true,
  },
  hr: {
    key: "hr",
    name: "Xodimlar (HR)",
    description: "Xodimlar kartochkasi, davomat, ta'til va maosh",
    icon: "UserCheck",
    dependsOn: [],
    defaultEnabled: true,
  },
  reports: {
    key: "reports",
    name: "Hisobot va tahlil",
    description: "Hisobotlar, analitika va AI tahlil",
    icon: "BarChart3",
    dependsOn: [],
    defaultEnabled: true,
  },
};

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

/** Shu modulga (to'g'ridan-to'g'ri) bog'liq modullar. */
export function moduleDependents(key: ModuleKey): ModuleKey[] {
  return MODULE_KEYS.filter((other) => MODULE_REGISTRY[other].dependsOn.includes(key));
}

/** Tanlangan modullar va ularning barcha bog'liqliklari (reyestr tartibida). */
export function withModuleDependencies(selected: readonly ModuleKey[]): ModuleKey[] {
  const result = new Set<ModuleKey>();
  const visit = (key: ModuleKey) => {
    if (result.has(key)) return;
    result.add(key);
    for (const dependency of MODULE_REGISTRY[key].dependsOn) visit(dependency);
  };
  for (const key of selected) visit(key);
  return MODULE_KEYS.filter((key) => result.has(key));
}

/**
 * Modulni olib tashlash — unga (bilvosita ham) bog'liq tanlangan modullar bilan birga.
 * Masalan "Sotuv" o'chirilsa, unga tayanadigan "Kassa" ham tanlovdan chiqadi.
 */
export function withoutModule(selected: readonly ModuleKey[], key: ModuleKey): ModuleKey[] {
  const removed = new Set<ModuleKey>([key]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const candidate of selected) {
      if (!removed.has(candidate) && MODULE_REGISTRY[candidate].dependsOn.some((dependency) => removed.has(dependency))) {
        removed.add(candidate);
        grew = true;
      }
    }
  }
  return selected.filter((candidate) => !removed.has(candidate));
}

export const DEFAULT_MODULE_SELECTION: readonly ModuleKey[] = MODULE_KEYS.filter((key) => MODULE_REGISTRY[key].defaultEnabled);

/** Kompaniya modullari holati: yozuv yo'q — yoqilgan (modullar joriy etilgunga qadar ochilgan kompaniyalar). */
export type CompanyModuleStates = Record<ModuleKey, boolean>;
