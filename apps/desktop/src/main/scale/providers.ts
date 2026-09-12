/**
 * Tarozi adapterlari (ScaleProvider): simulyator, umumiy ASCII og'irlik satri va protokoli tasdiqlanmagan tarozilar.
 * Tasdiqlanmagan adapter hech qachon buyruq yubormaydi va muvaffaqiyat qaytarmaydi — `PROTOCOL_DOCS_REQUIRED`.
 */
import { SCALE_PROVIDER_INFO, type ScaleConfig, type ScaleTestResult, type WeightReading } from "../../shared/scale-types.js";
import { decodeCommand, lastReading } from "./ascii-weight.js";
import { ScaleError, exchange, tcpProbe } from "./transports.js";

/** Taroziga yuboriladigan mahsulot: PLU, nomi va 1 kg narxi (asosiy valyutada). */
export type ScalePlu = { plu: number; productId: string; name: string; price: string };

export interface ScaleProvider {
  test(): Promise<Omit<ScaleTestResult, "at">>;
  readWeight(): Promise<WeightReading>;
  upload(items: ScalePlu[]): Promise<void>;
  remove(plus: number[]): Promise<void>;
  list(): Promise<ScalePlu[]>;
}

/** Simulyator "xotirasi" (kassa lokal bazasida — ilova qayta ochilsa ham solishtirish ishlaydi). */
export type SimulatorMemory = { load(): ScalePlu[]; save(items: ScalePlu[]): void };

const READ_TIMEOUT_MS = 2_500;

function unsupported(config: ScaleConfig, action: string): never {
  const info = SCALE_PROVIDER_INFO[config.provider];
  if (info.docsRequired) throw new ScaleError("PROTOCOL_DOCS_REQUIRED", `${info.label}: ${info.docsRequired}`);
  throw new ScaleError("NOT_SUPPORTED", `${info.label}: ${action} qo'llab-quvvatlanmaydi`);
}

class SimulatorProvider implements ScaleProvider {
  constructor(
    private readonly config: ScaleConfig,
    private readonly memory: SimulatorMemory,
  ) {}

  async test() {
    const reading = await this.readWeight();
    return { ok: true, status: "simulator" as const, message: "Simulyator ishlayapti — haqiqiy tarozi ulanmagan", reading };
  }

  async readWeight(): Promise<WeightReading> {
    const grams = Math.round(Number(this.config.simulatedWeight) * 1000);
    if (!(grams > 0)) throw new ScaleError("BAD_RESPONSE", "Simulyator og'irligi kiritilmagan");
    return { weight: (grams / 1000).toFixed(3), unit: "kg", stable: true, raw: null };
  }

  async upload(items: ScalePlu[]) {
    const byPlu = new Map(this.memory.load().map((item) => [item.plu, item]));
    for (const item of items) byPlu.set(item.plu, item);
    this.memory.save([...byPlu.values()].sort((a, b) => a.plu - b.plu));
  }

  async remove(plus: number[]) {
    const removed = new Set(plus);
    this.memory.save(this.memory.load().filter((item) => !removed.has(item.plu)));
  }

  async list() {
    return this.memory.load();
  }
}

class GenericAsciiProvider implements ScaleProvider {
  constructor(private readonly config: ScaleConfig) {}

  async test() {
    try {
      const reading = await this.readWeight();
      return { ok: true, status: "connected" as const, message: `Og'irlik o'qildi: ${reading.weight} kg${reading.stable ? "" : " (barqaror emas)"}`, reading };
    } catch (error) {
      const failure = error instanceof ScaleError ? error : new ScaleError("CONNECTION_FAILED", String(error));
      return { ok: false, status: failure.code === "CONNECTION_FAILED" ? ("unreachable" as const) : ("error" as const), message: failure.message, reading: null };
    }
  }

  /** Barqaror og'irlik kelguncha kutadi; vaqt tugasa — oxirgi o'qilgani (`stable: false`). */
  async readWeight(): Promise<WeightReading> {
    const data = await exchange(this.config.connection, {
      write: this.config.pollCommand ? decodeCommand(this.config.pollCommand) : undefined,
      until: (received) => lastReading(received)?.stable === true,
      timeoutMs: READ_TIMEOUT_MS,
      partialOnTimeout: true,
    });
    const reading = lastReading(data);
    if (reading) return reading;
    throw data.length > 0
      ? new ScaleError("BAD_RESPONSE", "Tarozi javobidan og'irlik ajratib bo'lmadi — format yoki so'rov buyrug'ini tekshiring")
      : new ScaleError("TIMEOUT", "Tarozi og'irlik yubormadi");
  }

  async upload(): Promise<void> {
    unsupported(this.config, "mahsulot yuborish");
  }

  async remove(): Promise<void> {
    unsupported(this.config, "mahsulot o'chirish");
  }

  async list(): Promise<ScalePlu[]> {
    return unsupported(this.config, "PLU ro'yxatini o'qish");
  }
}

/** Shtrix-M, YES POS, Rongta: protokol hujjati bo'lmaguncha faqat port ochiqligi; og'irlik va PLU — xato. */
class UndocumentedProvider implements ScaleProvider {
  constructor(private readonly config: ScaleConfig) {}

  async test() {
    const info = SCALE_PROVIDER_INFO[this.config.provider];
    const connection = this.config.connection;
    if (connection.type === "tcp") {
      const reachable = await tcpProbe(connection.host, connection.port, 2_000);
      return reachable
        ? {
            ok: false,
            status: "port_reachable" as const,
            message: `${connection.host}:${connection.port} ochiq, lekin ${info.label} protokoli tasdiqlanmagan — buyruq yuborilmadi. ${info.docsRequired}`,
            reading: null,
          }
        : { ok: false, status: "unreachable" as const, message: `${connection.host}:${connection.port} ga ulanib bo'lmadi`, reading: null };
    }
    return { ok: false, status: "docs_required" as const, message: `${info.label}: port ochilmadi, buyruq yuborilmadi — ${info.docsRequired}`, reading: null };
  }

  async readWeight(): Promise<WeightReading> {
    return unsupported(this.config, "og'irlik o'qish");
  }

  async upload(): Promise<void> {
    unsupported(this.config, "mahsulot yuborish");
  }

  async remove(): Promise<void> {
    unsupported(this.config, "mahsulot o'chirish");
  }

  async list(): Promise<ScalePlu[]> {
    return unsupported(this.config, "PLU ro'yxatini o'qish");
  }
}

export function createScaleProvider(config: ScaleConfig, simulator: SimulatorMemory): ScaleProvider {
  switch (config.provider) {
    case "simulator":
      return new SimulatorProvider(config, simulator);
    case "generic-ascii":
      return new GenericAsciiProvider(config);
    default:
      return new UndocumentedProvider(config);
  }
}
