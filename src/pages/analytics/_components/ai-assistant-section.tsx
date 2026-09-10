import { useState, useRef, useEffect } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api.js";
import { toast } from "sonner";
import { Send, Sparkles, User, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils.ts";
import { useTranslation } from "react-i18next";

type Message = { role: "user" | "assistant"; content: string; time: string };

const QUICK_QUESTIONS_BY_LANG: Record<string, string[]> = {
  uz: [
    "Omborda qaysi mahsulotlar tugab qolmoqda?",
    "Bu oy eng ko'p sotilgan 5 ta mahsulot qaysilar?",
    "Biznesning daromad va xarajat balansi qanday?",
    "Qaysi mijozlar eng ko'p xarid qilgan?",
    "Xodimlar uchun oylik maosh fondi qancha?",
    "Inventarizatsiya uchun qanday tavsiyalar berasiz?",
  ],
  ru: [
    "Какие товары заканчиваются на складе?",
    "Топ-5 продаваемых товаров этого месяца?",
    "Каков баланс доходов и расходов?",
    "Какие клиенты купили больше всего?",
    "Каков фонд оплаты труда за месяц?",
    "Дайте рекомендации по инвентаризации.",
  ],
  kk: [
    "Қоймада қандай тауарлар таусылып жатыр?",
    "Бұл айдың ең көп сатылған 5 тауары?",
    "Бизнестің кіріс пен шығыс балансы қандай?",
    "Қандай клиенттер ең көп сатып алды?",
    "Ай сайынғы жалақы қоры қанша?",
    "Инвентаризацияға қандай ұсыныстар беріледі?",
  ],
};

export default function AIAssistantSection() {
  const { t, i18n } = useTranslation("modules");
  const lang = i18n.language as "uz" | "ru" | "kk";
  const QUICK_QUESTIONS = QUICK_QUESTIONS_BY_LANG[lang] ?? QUICK_QUESTIONS_BY_LANG.uz;

  const GREETINGS: Record<string, string> = {
    uz: "Salom! Men ERP AI Yordamchiman. Biznesingiz haqida real ma'lumotlar asosida savollarga javob beraman — savdo, ombor, xarajatlar, xodimlar va boshqalar. Nima bilmoqchisiz?",
    ru: "Здравствуйте! Я ERP AI Помощник. Отвечаю на вопросы о вашем бизнесе на основе реальных данных — продажи, склад, расходы, сотрудники и другое. Что вас интересует?",
    kk: "Сәлем! Мен ERP AI Көмекшімін. Бизнесіңіз туралы нақты деректер негізінде сұрақтарға жауап беремін — сату, қойма, шығыстар, қызметкерлер және т.б. Не білгіңіз келеді?",
  };
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: GREETINGS[lang] ?? GREETINGS.uz,
      time: new Date().toLocaleTimeString(lang === "ru" ? "ru-RU" : lang === "kk" ? "kk-KZ" : "uz-UZ", { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const askAssistant = useAction(api.analytics.ai.askAssistant);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (question?: string) => {
    const text = question ?? input.trim();
    if (!text || loading) return;

    const time = new Date().toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
    setMessages((prev) => [...prev, { role: "user", content: text, time }]);
    setInput("");
    setLoading(true);

    try {
      const { answer } = await askAssistant({ question: text });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: answer,
          time: new Date().toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI xatoligi");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Kechirasiz, xatolik yuz berdi. Qayta urinib ko'ring.", time },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-280px)] min-h-[500px]">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-border mb-4">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="font-semibold">{t("analytics.ai.title")}</p>
          <p className="text-xs text-muted-foreground">{t("analytics.ai.subtitle")}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-muted-foreground">{t("analytics.ai.active")}</span>
        </div>
      </div>

      {/* Quick questions */}
      {messages.length <= 1 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {QUICK_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => handleSend(q)}
              className="text-xs px-3 py-1.5 rounded-lg bg-muted hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-2">
        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={cn("flex gap-3", msg.role === "user" ? "flex-row-reverse" : "")}
            >
              <div className={cn(
                "h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0",
                msg.role === "assistant" ? "bg-gradient-to-br from-indigo-500 to-violet-600" : "bg-primary"
              )}>
                {msg.role === "assistant" ? <Sparkles className="h-4 w-4 text-white" /> : <User className="h-4 w-4 text-primary-foreground" />}
              </div>
              <div className={cn("max-w-[80%] space-y-1", msg.role === "user" ? "items-end" : "")}>
                <div className={cn(
                  "px-4 py-3 rounded-2xl text-sm leading-relaxed",
                  msg.role === "assistant"
                    ? "bg-card border border-border"
                    : "bg-primary text-primary-foreground"
                )}>
                  {msg.content.split("\n").map((line, j) => (
                    <p key={j} className={j > 0 ? "mt-1" : ""}>{line}</p>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground px-1">{msg.time}</p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {loading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div className="bg-card border border-border px-4 py-3 rounded-2xl">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </motion.div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="pt-4 border-t border-border mt-4">
        <div className="flex gap-2">
          <Textarea
            className="flex-1 min-h-[48px] max-h-32 resize-none"
            placeholder={t("analytics.ai.placeholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button className="h-12 w-12 p-0 flex-shrink-0" onClick={() => handleSend()} disabled={!input.trim() || loading}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">Enter — yuborish · Shift+Enter — yangi qator</p>
      </div>
    </div>
  );
}
