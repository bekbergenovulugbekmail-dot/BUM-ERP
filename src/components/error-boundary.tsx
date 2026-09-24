/**
 * Xato chegarasi: bitta bo'limdagi xato BUTUN ilovani o'chirib yubormasin.
 *
 * Regressiya (2026-09-24): "Dostavka" ga kirilganda sahifa butunlay oq bo'lib qoldi — yon menyu
 * ham yo'qoldi. Sabab: React'da ushlanmagan xato daraxtni yechib tashlaydi, ilovada esa chegara
 * yo'q edi. Endi xato bo'limda ushlanadi: menyu joyida qoladi, foydalanuvchi xato matnini
 * ko'radi va nusxa olib yubora oladi (oq ekrandan sabab bilib bo'lmasdi).
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";

type Props = {
  children: ReactNode;
  /** Qaysi joy — xato matnida ko'rinadi ("Dostavka"). */
  area?: string;
  /** Marshrut o'zgarganda chegara tiklanadi — boshqa bo'limga o'tish ishlaydi. */
  resetKey?: string;
};

type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Konsolda to'liq iz qolsin — qo'llab-quvvatlash uchun birinchi manba
    console.error(`[BUM ERP] ${this.props.area ?? "Bo'lim"} xatosi:`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const details = `${this.props.area ?? "Bo'lim"}: ${error.message}\n${error.stack ?? ""}`.trim();
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">Bu bo'limni ochib bo'lmadi</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Ma'lumotlaringiz saqlanib qoldi. Qayta urinib ko'ring; takrorlansa quyidagi matnni yuboring.
              </p>
              <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-[11px] leading-relaxed">
                {details}
              </pre>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => this.setState({ error: null })}>
                  <RotateCcw className="mr-1.5 h-4 w-4" /> Qayta urinish
                </Button>
                <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
                  Sahifani yangilash
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void navigator.clipboard?.writeText(details)}
                >
                  Xato matnini nusxalash
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
