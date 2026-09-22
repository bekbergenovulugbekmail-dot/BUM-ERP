/**
 * `/uz/admin` sahifasi: kirilmagan foydalanuvchiga KIRISH FORMASI chiqishi kerak.
 *
 * Regressiya: ilgari kirilmagan holatda sahifa `/{lng}/admin` ga — ya'ni o'ziga o'ziga —
 * yo'naltirardi va brauzer cheksiz aylanib oq ekran ko'rsatardi.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

type Me = { id: string; phone: string; isPlatformAdmin: boolean } | null | undefined;
let currentUser: Me = null;

vi.mock("@/hooks/use-auth.ts", () => ({
  useCurrentUser: () => currentUser,
  useAuth: () => ({
    isLoading: currentUser === undefined,
    isAuthenticated: Boolean(currentUser),
    signout: vi.fn(),
    signInWithPassword: vi.fn(),
  }),
}));
// Panel ichidagi so'rovlar bu testga aloqador emas
vi.mock("@/lib/query.ts", () => ({
  useApiQuery: () => ({ data: undefined, isLoading: false }),
  useApiMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { default: AdminPage } = await import("./page.tsx");

function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={["/uz/admin"]}>
      <Routes>
        <Route path="/:lng/admin" element={<AdminPage />} />
        <Route path="/:lng/dashboard" element={<div>Dashboard sahifasi</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Admin paneli — /uz/admin", () => {
  it("kirilmagan bo'lsa kirish formasi chiqadi (oq ekran emas)", () => {
    currentUser = null;
    renderAdmin();

    expect(screen.getByRole("heading", { name: /BUM ERP Admin/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("+998901234567")).toBeInTheDocument();
    // Oq ekran emas: kirish formasi chizilgan
    expect(screen.getByText(/Cheklangan kirish/i)).toBeInTheDocument();
  });

  it("kompaniya egasi (admin emas) boshqa hisobga o'tish tugmasini ko'radi", () => {
    currentUser = { id: "u1", phone: "+998901234567", isPlatformAdmin: false };
    renderAdmin();

    expect(screen.getByText(/Kirish taqiqlangan/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Boshqa akkaunt bilan kiring/i })).toBeInTheDocument();
  });
});
