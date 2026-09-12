import { once } from "node:events";
import { createServer, type Server, type Socket } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/main/local-db.js";
import { LocalStore } from "../src/main/local-store.js";
import { decodeCommand, lastReading, parseAsciiWeight } from "../src/main/scale/ascii-weight.js";
import { createScaleProvider, type ScalePlu, type ScaleProvider } from "../src/main/scale/providers.js";
import { ScaleService, backoffMs, type ScaleCatalogItem } from "../src/main/scale/scale-service.js";
import { ScaleError, serialExchange } from "../src/main/scale/transports.js";
import { ean13CheckDigit, normalizeWeightBarcodeFormat, parseWeightBarcode } from "../src/shared/scale-barcode.js";
import type { ScaleConfig, ScaleConfigInput, SerialConnection } from "../src/shared/scale-types.js";

const servers: { server: Server; sockets: Set<Socket> }[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(({ server, sockets }) => {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(resolve));
    }),
  );
});

/** Soxta LAN tarozi: qabul qilingan baytlar yoziladi (hujjatsiz adapter hech narsa yubormasligini tekshirish uchun). */
async function fakeScale(onConnection: (socket: Socket) => void = () => undefined) {
  const received: Buffer[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("data", (data) => received.push(data));
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
    onConnection(socket);
  });
  servers.push({ server, sockets });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { port: (server.address() as { port: number }).port, received };
}

const config = (patch: Partial<ScaleConfig>): ScaleConfig => ({
  id: "s1",
  name: "Tarozi",
  provider: "generic-ascii",
  connection: { type: "none" },
  enabled: true,
  autoSync: true,
  maxAttempts: 3,
  pollCommand: "",
  simulatedWeight: "1.250",
  createdAt: "",
  updatedAt: "",
  ...patch,
});
const noMemory = { load: () => [], save: () => undefined };
const tcp = (port: number) => ({ type: "tcp" as const, host: "127.0.0.1", port });

describe("Tarozi: og'irlik satri va etiketka shtrix-kodi", () => {
  it("ASCII og'irlik (barqaror/beqaror, gramm, vergul, manfiy), oxirgi to'liq satr, so'rov buyrug'i baytlari", () => {
    expect(parseAsciiWeight("ST,GS,+  1.234kg")).toEqual({ weight: "1.234", unit: "kg", stable: true, raw: "ST,GS,+  1.234kg" });
    expect(parseAsciiWeight("US,GS,+  0,50 kg")).toMatchObject({ weight: "0.500", stable: false });
    expect(parseAsciiWeight("  1250 g")).toMatchObject({ weight: "1.250", stable: false });
    expect(parseAsciiWeight("ST,GS,-  0.020kg")).toMatchObject({ weight: "-0.020", stable: true });
    expect(parseAsciiWeight("OL")).toBeNull();
    expect(lastReading(Buffer.from("US,GS, 1.100kg\r\nST,GS, 1.200kg\r\nST,GS, 1.3"))).toMatchObject({ weight: "1.200", stable: true });
    expect(decodeCommand("W\\r\\n\\x05")).toEqual(Buffer.from([0x57, 0x0d, 0x0a, 0x05]));
  });

  it("EAN-13 etiketka: prefiks, PLU, og'irlik kasrlari, nazorat raqami; sozlama normallashtiriladi", () => {
    expect(ean13CheckDigit("400638133393")).toBe(1);
    const format = normalizeWeightBarcodeFormat({ enabled: true, prefixes: ["22"], codeLength: 5, weightDecimals: 3 });
    const withCheck = (body: string) => body + ean13CheckDigit(body);
    expect(parseWeightBarcode(withCheck("220012301234"), format)).toEqual({ plu: 123, quantity: "1.234" });
    expect(parseWeightBarcode(withCheck("220045600500"), format)).toEqual({ plu: 456, quantity: "0.500" });
    // Nazorat raqami xato, boshqa prefiks, o'chirilgan, og'irlik 0 — oddiy shtrix-kod sifatida qidiriladi
    expect(parseWeightBarcode(`220012301234${(ean13CheckDigit("220012301234") + 1) % 10}`, format)).toBeNull();
    expect(parseWeightBarcode(withCheck("230012301234"), format)).toBeNull();
    expect(parseWeightBarcode(withCheck("220012301234"), { ...format, enabled: false })).toBeNull();
    expect(parseWeightBarcode(withCheck("220012300000"), format)).toBeNull();
    const six = normalizeWeightBarcodeFormat({ enabled: true, prefixes: ["21", "22"], codeLength: 6 });
    expect(six).toMatchObject({ codeLength: 6, weightDecimals: 3 });
    expect(parseWeightBarcode(withCheck("210001231234"), six)).toEqual({ plu: 123, quantity: "1.234" });
    expect(normalizeWeightBarcodeFormat({ enabled: true, prefixes: ["55"], codeLength: 9, weightDecimals: 7 })).toEqual({
      enabled: true,
      prefixes: ["22"],
      codeLength: 5,
      weightDecimals: 3,
    });
  });
});

describe("Tarozi adapterlari", () => {
  it(
    "umumiy ASCII (TCP): barqaror og'irlikni kutadi, so'rov buyrug'i, faqat beqaror, javobsiz va ulanmaydigan tarozi",
    async () => {
      const continuous = await fakeScale((socket) => {
        socket.write("US,GS,+  1.100kg\r\n");
        const timer = setTimeout(() => socket.write("ST,GS,+  1.234kg\r\n"), 50);
        socket.on("close", () => clearTimeout(timer));
      });
      const provider = createScaleProvider(config({ connection: tcp(continuous.port) }), noMemory);
      expect(await provider.readWeight()).toMatchObject({ weight: "1.234", stable: true });
      expect(await provider.test()).toMatchObject({ ok: true, status: "connected", reading: { weight: "1.234" } });
      await expect(provider.upload([])).rejects.toMatchObject({ code: "NOT_SUPPORTED" });

      const polled = await fakeScale((socket) => {
        socket.on("data", (data) => {
          if (data.toString() === "W\r\n") socket.write("ST,NT,  0.750kg\r\n");
        });
      });
      expect(await createScaleProvider(config({ connection: tcp(polled.port), pollCommand: "W\\r\\n" }), noMemory).readWeight()).toMatchObject({ weight: "0.750" });
      expect(Buffer.concat(polled.received).toString()).toBe("W\r\n");

      const shaky = await fakeScale((socket) => socket.write("US,GS,  2.000kg\r\n"));
      expect(await createScaleProvider(config({ connection: tcp(shaky.port) }), noMemory).readWeight()).toMatchObject({ weight: "2.000", stable: false });

      const silent = await fakeScale();
      await expect(createScaleProvider(config({ connection: tcp(silent.port) }), noMemory).readWeight()).rejects.toMatchObject({ code: "TIMEOUT" });

      const closed = await fakeScale();
      const { server } = servers.pop()!;
      await new Promise((resolve) => server.close(resolve));
      const unreachable = createScaleProvider(config({ connection: tcp(closed.port) }), noMemory);
      await expect(unreachable.readWeight()).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
      expect(await unreachable.test()).toMatchObject({ ok: false, status: "unreachable" });
    },
    30_000,
  );

  it("Shtrix-M, YES POS, Rongta: protokol hujjatisiz buyruq yuborilmaydi — faqat port, og'irlik va PLU xato", async () => {
    const listening = await fakeScale();
    for (const provider of ["shtrih-m", "yes-pos", "rongta"] as const) {
      const adapter = createScaleProvider(config({ provider, connection: tcp(listening.port) }), noMemory);
      const result = await adapter.test();
      expect(result).toMatchObject({ ok: false, status: "port_reachable", reading: null });
      expect(result.message).toContain("protokoli tasdiqlanmagan");
      await expect(adapter.readWeight()).rejects.toMatchObject({ code: "PROTOCOL_DOCS_REQUIRED" });
      await expect(adapter.upload([{ plu: 1, productId: "p1", name: "Go'sht", price: "1" }])).rejects.toMatchObject({ code: "PROTOCOL_DOCS_REQUIRED" });
      await expect(adapter.list()).rejects.toBeInstanceOf(ScaleError);
    }
    // Hech bir adapter taroziga bayt yubormadi
    expect(Buffer.concat(listening.received)).toHaveLength(0);

    const com: SerialConnection = { type: "serial", port: "COM3", baudRate: 9600, dataBits: 8, parity: "none", stopBits: 1 };
    expect(await createScaleProvider(config({ provider: "rongta", connection: com }), noMemory).test()).toMatchObject({ ok: false, status: "docs_required" });
    await expect(serialExchange({ ...com, port: "COM3 & calc" }, { timeoutMs: 100 }, "win32")).rejects.toMatchObject({ code: "BAD_CONFIG" });
    await expect(serialExchange(com, { timeoutMs: 100 }, "linux")).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
  });
});

describe("Tarozi xizmati: sozlamalar va sinxron navbati", () => {
  let store: LocalStore;

  beforeEach(() => {
    const db = new DatabaseSync(":memory:");
    migrate(db);
    store = new LocalStore(db);
  });

  const catalogOf = (items: ScaleCatalogItem[]) => {
    const map = new Map(items.map((item) => [item.productId, item]));
    return {
      items: map,
      product: (productId: string) => map.get(productId) ?? null,
      weighted: () => [...map.values()].filter((item) => item.weighted),
    };
  };
  const base: ScaleConfigInput = {
    name: "Go'sht tarozisi",
    provider: "simulator",
    connection: { type: "none" },
    enabled: true,
    autoSync: true,
    maxAttempts: 3,
    pollCommand: "",
    simulatedWeight: "0.845",
  };

  it("sozlama tekshiruvi, simulyator (sinov, og'irlik, yuborish, solishtirish), hujjatsiz tarozi, o'chirish", async () => {
    const catalog = catalogOf([{ productId: "p1", name: "Mol go'shti", plu: 7, price: "95000.00", weighted: true, active: true }]);
    const scales = new ScaleService(store, catalog);
    expect(() => scales.save({ ...base, name: " " })).toThrow("nomi");
    expect(() => scales.save({ ...base, provider: "generic-ascii" })).toThrow("ulanish turi");
    expect(() => scales.save({ ...base, provider: "generic-ascii", connection: { type: "tcp", host: "bad host", port: 80 } })).toThrow("host");
    expect(() => scales.save({ ...base, provider: "generic-ascii", connection: { type: "tcp", host: "192.168.1.50", port: 70_000 } })).toThrow("Port");
    expect(() => scales.save({ ...base, provider: "rongta", connection: { type: "serial", port: "LPT1", baudRate: 9600, dataBits: 8, parity: "none", stopBits: 1 } })).toThrow(
      "COM",
    );
    expect(() => scales.save({ ...base, maxAttempts: 0 })).toThrow("1–20");
    expect(() => scales.save({ ...base, id: "yo'q" })).toThrow("topilmadi");

    const simulator = scales.save(base);
    expect(simulator).toMatchObject({ name: "Go'sht tarozisi", info: { capabilities: { uploadProducts: true } }, queue: { PENDING: 0 }, lastTest: null });
    expect(await scales.test(simulator.id)).toMatchObject({ ok: true, status: "simulator", reading: { weight: "0.845" } });
    expect(scales.list()[0]!.lastTest).toMatchObject({ status: "simulator" });
    expect(await scales.readWeight()).toMatchObject({ weight: "0.845", stable: true, scaleName: "Go'sht tarozisi" });

    expect(scales.enqueueProducts(["p1"])).toBe(1);
    expect(await scales.processQueue()).toEqual({ sent: 1, failed: 0, waiting: 0 });
    expect(store.getMeta<ScalePlu[]>(`scaleSimulator:${simulator.id}`)).toEqual([{ plu: 7, productId: "p1", name: "Mol go'shti", price: "95000.00" }]);
    expect(await scales.reconcile(simulator.id)).toMatchObject({ source: "scale", missingOnScale: [], extraOnScale: [], mismatched: [], inSync: 1 });

    const shtrih = scales.save({ ...base, name: "Shtrix", provider: "shtrih-m", connection: { type: "tcp", host: "127.0.0.1", port: 1 } });
    expect(shtrih.info.docsRequired).toContain("protokoli hujjati");
    await expect(scales.readWeight(shtrih.id)).rejects.toMatchObject({ code: "PROTOCOL_DOCS_REQUIRED" });
    await expect(scales.fullSync(shtrih.id)).rejects.toMatchObject({ code: "PROTOCOL_DOCS_REQUIRED" });
    // Hujjatsiz tarozi avtomatik navbatga olinmaydi
    expect(scales.enqueueProducts(["p1"])).toBe(0);

    scales.remove(simulator.id);
    expect(scales.list().map((scale) => scale.name)).toEqual(["Shtrix"]);
    expect(store.db.prepare("SELECT count(*) AS n FROM scale_sync_queue").get()).toEqual({ n: 0 });
    expect(store.getMeta(`scaleSimulator:${simulator.id}`)).toBeNull();
  });

  it("navbat: faqat tortiladigan, qayta urinish (5 s, 10 s), FAILED va qo'lda qayta, o'zgarmagani qayta yuborilmaydi, PLU almashuvi, to'liq sinxron va solishtirish", async () => {
    let now = new Date("2026-09-12T10:00:00.000Z");
    let failures = 0;
    const sent: string[] = [];
    const onScale = new Map<number, ScalePlu>();
    const flaky = () => {
      if (failures > 0) {
        failures -= 1;
        throw new ScaleError("CONNECTION_FAILED", "Tarozi javob bermadi");
      }
    };
    const fake: ScaleProvider = {
      test: async () => ({ ok: true, status: "connected", message: "ok", reading: null }),
      readWeight: async () => ({ weight: "1.000", unit: "kg", stable: true, raw: null }),
      upload: async (items) => {
        flaky();
        for (const item of items) {
          onScale.set(item.plu, item);
          sent.push(`+${item.plu}:${item.price}`);
        }
      },
      remove: async (plus) => {
        flaky();
        for (const plu of plus) {
          onScale.delete(plu);
          sent.push(`-${plu}`);
        }
      },
      list: async () => [...onScale.values()],
    };
    const catalog = catalogOf([
      { productId: "p1", name: "Mol go'shti", plu: 101, price: "95000.00", weighted: true, active: true },
      { productId: "p2", name: "Pishloq", plu: 102, price: "60000.00", weighted: true, active: true },
      { productId: "p3", name: "Non", plu: null, price: "4000.00", weighted: false, active: true },
    ]);
    const update = (productId: string, patch: Partial<ScaleCatalogItem>) => catalog.items.set(productId, { ...catalog.items.get(productId)!, ...patch });
    const scales = new ScaleService(store, catalog, { now: () => now, providerFactory: () => fake });
    const scale = scales.save(base);

    expect(scales.enqueueProducts(["p1", "p2", "p3"])).toBe(2);
    expect(scales.enqueueProducts(["p1"])).toBe(1);
    expect(scales.list()[0]!.queue).toMatchObject({ PENDING: 2 });

    // Xato — PENDING, 5 soniyadan keyin; muddatidan oldin yuborilmaydi
    failures = 1;
    expect(await scales.processQueue()).toEqual({ sent: 0, failed: 0, waiting: 2 });
    const waiting = scales.queue(scale.id);
    expect(waiting.map((item) => [item.status, item.attempts, item.lastError])).toEqual([
      ["PENDING", 1, "Tarozi javob bermadi"],
      ["PENDING", 1, "Tarozi javob bermadi"],
    ]);
    expect(waiting[0]!.nextAttemptAt).toBe("2026-09-12T10:00:05.000Z");
    now = new Date("2026-09-12T10:00:04.000Z");
    expect(await scales.processQueue()).toEqual({ sent: 0, failed: 0, waiting: 2 });
    now = new Date("2026-09-12T10:00:05.000Z");
    expect(await scales.processQueue()).toEqual({ sent: 2, failed: 0, waiting: 0 });
    expect(sent).toEqual(["+101:95000.00", "+102:60000.00"]);

    // O'zgarmagan — navbatga tushmaydi; narx o'zgardi — yuboriladi; PLU o'zgardi — eskisi o'chiriladi
    expect(scales.enqueueProducts(["p1", "p2"])).toBe(0);
    update("p1", { price: "99000.00" });
    update("p2", { plu: 202 });
    expect(scales.enqueueProducts(["p1", "p2"])).toBe(3);
    await scales.processQueue();
    expect(sent.slice(2)).toEqual(["+101:99000.00", "+202:60000.00", "-102"]);
    update("p1", { weighted: false });
    expect(scales.enqueueProducts(["p1"])).toBe(1);
    await scales.processQueue();
    expect(sent.at(-1)).toBe("-101");

    // Urinishlar tugadi (3) → FAILED; qo'lda qayta yuborish
    expect([backoffMs(1), backoffMs(2), backoffMs(3), backoffMs(30)]).toEqual([5_000, 10_000, 20_000, 600_000]);
    update("p2", { price: "65000.00" });
    scales.enqueueProducts(["p2"]);
    failures = 10;
    now = new Date("2026-09-12T10:01:00.000Z");
    await scales.processQueue();
    now = new Date("2026-09-12T10:01:05.000Z");
    await scales.processQueue();
    now = new Date("2026-09-12T10:01:15.000Z");
    expect(await scales.processQueue()).toEqual({ sent: 0, failed: 1, waiting: 0 });
    expect(scales.queue(scale.id, { status: "FAILED" })).toMatchObject([{ plu: 202, attempts: 3, productName: "Pishloq", lastError: "Tarozi javob bermadi" }]);
    failures = 0;
    expect(scales.retry(scale.id)).toBe(1);
    expect(await scales.processQueue()).toEqual({ sent: 1, failed: 0, waiting: 0 });
    expect(sent.at(-1)).toBe("+202:65000.00");

    // Tarozida begona PLU va eskirgan nom — solishtirish ko'rsatadi; to'liq sinxron tuzatadi (progress bilan)
    onScale.set(999, { plu: 999, productId: "boshqa", name: "Begona", price: "1.00" });
    onScale.set(202, { ...onScale.get(202)!, name: "Eski nom" });
    expect(await scales.reconcile(scale.id)).toMatchObject({
      source: "scale",
      missingOnScale: [],
      extraOnScale: [{ plu: 999, name: "Begona" }],
      mismatched: [{ plu: 202, field: "name", expected: "Pishloq", actual: "Eski nom" }],
      inSync: 0,
    });
    update("p1", { weighted: true });
    const run = await scales.fullSync(scale.id);
    expect(run.total).toBe(3);
    expect(scales.list()[0]!.lastRun).toMatchObject({ runId: run.runId, total: 3, counts: { PENDING: 3, SUCCESS: 0 } });
    await scales.processQueue();
    expect(scales.list()[0]!.lastRun!.counts).toMatchObject({ PENDING: 0, PROCESSING: 0, SUCCESS: 3, FAILED: 0 });
    expect([...onScale.keys()].sort((a, b) => a - b)).toEqual([101, 202]);
    expect(await scales.reconcile(scale.id)).toMatchObject({ missingOnScale: [], extraOnScale: [], mismatched: [], inSync: 2 });

    // Ilova yuborish paytida yopilgan — PROCESSING qayta navbatga
    store.db.prepare("UPDATE scale_sync_queue SET status = 'PROCESSING' WHERE id = (SELECT max(id) FROM scale_sync_queue)").run();
    new ScaleService(store, catalog, { now: () => now, providerFactory: () => fake });
    expect(scales.list()[0]!.queue.PROCESSING).toBe(0);
  });
});
