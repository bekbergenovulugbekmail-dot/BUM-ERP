/**
 * Tarozi bilan bayt almashinuvi: LAN (TCP) va COM port (USB tarozilar — virtual COM). Qo'shimcha native modul yo'q:
 * COM port Windows PowerShell'dagi .NET `System.IO.Ports.SerialPort` orqali alohida jarayonda, vaqt chegarasi bilan.
 * Bu qatlamda protokol yo'q — faqat berilgan baytlarni yuborish va javobni yig'ish.
 */
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import type { ScaleConnection, SerialConnection } from "../../shared/scale-types.js";

export type ScaleErrorCode = "BAD_CONFIG" | "NOT_CONFIGURED" | "CONNECTION_FAILED" | "TIMEOUT" | "BAD_RESPONSE" | "NOT_SUPPORTED" | "PROTOCOL_DOCS_REQUIRED";

export class ScaleError extends Error {
  readonly code: ScaleErrorCode;

  constructor(code: ScaleErrorCode, message: string) {
    super(message);
    this.name = "ScaleError";
    this.code = code;
  }
}

export type ExchangeOptions = {
  write?: Buffer;
  /** Javob yetarli bo'lsa true — ulanish darhol yopiladi. */
  until?: (received: Buffer) => boolean;
  timeoutMs: number;
  /** Vaqt tugaganda yig'ilganini qaytarish (xato o'rniga). */
  partialOnTimeout?: boolean;
};

export function tcpExchange(host: string, port: number, options: ExchangeOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let connected = false;
    let settled = false;
    const received = () => Buffer.concat(chunks);
    const socket = createConnection({ host, port });
    const finish = (error: ScaleError | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(received());
    };
    const timer = setTimeout(() => {
      if (!connected) finish(new ScaleError("CONNECTION_FAILED", `${host}:${port} — ulanish vaqti tugadi`));
      else if (options.partialOnTimeout || !options.until) finish(null);
      else finish(new ScaleError("TIMEOUT", chunks.length > 0 ? "Tarozi javobi to'liq kelmadi" : "Tarozi javob bermadi"));
    }, options.timeoutMs);
    socket.on("connect", () => {
      connected = true;
      if (options.write && options.write.length > 0) socket.write(options.write);
    });
    socket.on("data", (data: Buffer) => {
      chunks.push(data);
      if (options.until?.(received())) finish(null);
    });
    socket.on("error", (error) => finish(new ScaleError("CONNECTION_FAILED", `${host}:${port} — ${error.message}`)));
    socket.on("close", () => {
      if (options.until && !options.until(received()) && !options.partialOnTimeout) finish(new ScaleError("BAD_RESPONSE", "Tarozi ulanishni javobsiz yopdi"));
      else finish(null);
    });
  });
}

/** Port ochiqmi — faqat TCP ulanish (hech qanday bayt yuborilmaydi). */
export function tcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (ok: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

const COM_PORT = /^COM[1-9]\d{0,2}$/i;
const PARITY = { none: "None", even: "Even", odd: "Odd" } as const;

// Sozlamalar muhit o'zgaruvchilari orqali (buyruq satriga foydalanuvchi matni qo'shilmaydi)
const SERIAL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$port = New-Object System.IO.Ports.SerialPort $env:BUM_SCALE_PORT, ([int]$env:BUM_SCALE_BAUD), ([System.IO.Ports.Parity]$env:BUM_SCALE_PARITY), ([int]$env:BUM_SCALE_DATA), ([System.IO.Ports.StopBits]$env:BUM_SCALE_STOP)",
  "$port.ReadTimeout = 100",
  "$port.Open()",
  "try {",
  "  if ($env:BUM_SCALE_WRITE) { $bytes = [Convert]::FromBase64String($env:BUM_SCALE_WRITE); $port.Write($bytes, 0, $bytes.Length) }",
  "  $deadline = [DateTime]::UtcNow.AddMilliseconds([int]$env:BUM_SCALE_TIMEOUT)",
  "  $buffer = New-Object byte[] 4096",
  "  while ([DateTime]::UtcNow -lt $deadline) {",
  "    try { $count = $port.Read($buffer, 0, $buffer.Length); if ($count -gt 0) { [Console]::Out.WriteLine([Convert]::ToBase64String($buffer, 0, $count)); [Console]::Out.Flush() } } catch [System.TimeoutException] { }",
  "  }",
  "} finally { $port.Close() }",
].join("\n");

const firstLine = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 200) ?? "";

export function serialExchange(connection: SerialConnection, options: ExchangeOptions, platform: string = process.platform): Promise<Buffer> {
  if (!COM_PORT.test(connection.port)) return Promise.reject(new ScaleError("BAD_CONFIG", "COM port nomi noto'g'ri (masalan COM3)"));
  if (platform !== "win32") return Promise.reject(new ScaleError("NOT_SUPPORTED", "COM port faqat Windows'da qo'llab-quvvatlanadi"));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let stderr = "";
    let pending = "";
    let settled = false;
    const received = () => Buffer.concat(chunks);
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SERIAL_SCRIPT], {
      windowsHide: true,
      env: {
        ...process.env,
        BUM_SCALE_PORT: connection.port.toUpperCase(),
        BUM_SCALE_BAUD: String(connection.baudRate),
        BUM_SCALE_PARITY: PARITY[connection.parity],
        BUM_SCALE_DATA: String(connection.dataBits),
        BUM_SCALE_STOP: connection.stopBits === 2 ? "Two" : "One",
        BUM_SCALE_WRITE: options.write?.toString("base64") ?? "",
        BUM_SCALE_TIMEOUT: String(options.timeoutMs),
      },
    });
    const finish = (error: ScaleError | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      if (child.exitCode === null) child.kill();
      if (error) reject(error);
      else resolve(received());
    };
    // PowerShell ishga tushishi uchun qo'shimcha vaqt
    const guard = setTimeout(
      () => finish(options.partialOnTimeout || !options.until ? null : new ScaleError("TIMEOUT", "Tarozi javob bermadi")),
      options.timeoutMs + 5_000,
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text: string) => {
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) chunks.push(Buffer.from(line.trim(), "base64"));
      if (options.until?.(received())) finish(null);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text: string) => {
      stderr += text;
    });
    child.on("error", (error) => finish(new ScaleError("NOT_SUPPORTED", `PowerShell ishga tushmadi: ${error.message}`)));
    child.on("close", (code) => {
      if (code !== 0 && chunks.length === 0) finish(new ScaleError("CONNECTION_FAILED", `${connection.port}: ${firstLine(stderr) || `port ochilmadi (kod ${code})`}`));
      else if (options.until && !options.until(received()) && !options.partialOnTimeout) {
        finish(new ScaleError(chunks.length > 0 ? "BAD_RESPONSE" : "TIMEOUT", chunks.length > 0 ? "Tarozi javobi to'liq kelmadi" : "Tarozi javob bermadi"));
      } else finish(null);
    });
  });
}

export function exchange(connection: ScaleConnection, options: ExchangeOptions): Promise<Buffer> {
  if (connection.type === "tcp") return tcpExchange(connection.host, connection.port, options);
  if (connection.type === "serial") return serialExchange(connection, options);
  return Promise.reject(new ScaleError("BAD_CONFIG", "Ulanish turi tanlanmagan"));
}
