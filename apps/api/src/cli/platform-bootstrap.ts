/**
 * Birinchi platforma adminini yaratish — bazaga kirish huquqi bor joydan
 * (lokal yoki `railway run`). PLATFORM_BOOTSTRAP_KEY kerak emas.
 *
 *   pnpm --filter @bum/api platform:bootstrap --phone +998901234567 --name "Ism"
 *
 * Parol buyruq qatorida BERILMAYDI (shell tarixiga tushmasligi uchun):
 * BOOTSTRAP_ADMIN_PASSWORD muhit o'zgaruvchisidan yoki terminalda yashirin
 * so'rov orqali olinadi.
 *
 * Windows + Volta: foydalanuvchi papkasi yo'lida bo'sh joy bo'lsa, pnpm
 * bo'sh joyli argumentni (--name "Ism Familiya") buzadi. Unda apps/api dan:
 *   node --import tsx src/cli/platform-bootstrap.ts --phone ... --name "Ism Familiya"
 */
import { parseArgs } from "node:util";
import { closeDb } from "../db/client.js";
import { withTransaction } from "../db/transaction.js";
import { bootstrapPlatformAdmin } from "../modules/platform/bootstrap.service.js";

const USAGE =
  'Foydalanish: pnpm --filter @bum/api platform:bootstrap --phone +998XXXXXXXXX [--name "Ism"]';

const CTRL_C = String.fromCharCode(3);
const DELETE = String.fromCharCode(127);
const BACKSPACE = String.fromCharCode(8);

function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY || !stdin.setRawMode) {
    return Promise.reject(
      new Error("Terminal interaktiv emas — parolni BOOTSTRAP_ADMIN_PASSWORD orqali bering"),
    );
  }

  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode?.(false);
      stdin.pause();
      stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (ch === CTRL_C) {
          cleanup();
          reject(new Error("Bekor qilindi"));
          return;
        }
        value = ch === DELETE || ch === BACKSPACE ? value.slice(0, -1) : value + ch;
      }
    };

    stdout.write(question);
    stdin.setRawMode?.(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

try {
  // pnpm ba'zan argumentlar oldidan "--" qo'shadi
  const argv = process.argv.slice(2).filter((arg, i) => !(i === 0 && arg === "--"));
  const { values } = parseArgs({
    args: argv,
    options: { phone: { type: "string" }, name: { type: "string" } },
  });
  if (!values.phone) throw new Error(USAGE);
  const phone = values.phone;

  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? (await promptHidden("Parol: "));

  const result = await withTransaction((tx) =>
    bootstrapPlatformAdmin(
      tx,
      { phone, password, name: values.name ?? null },
      { ipAddress: "cli", userAgent: null, via: "cli" },
    ),
  );

  console.log(
    `${result.created ? "Yaratildi" : "Mavjud hisobga berildi"}: ${result.user.phone} — platforma admini. ` +
      `Qo'shilgan global rollar: ${result.rolesSeeded}`,
  );
} catch (err) {
  console.error(`Xato: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await closeDb();
}
