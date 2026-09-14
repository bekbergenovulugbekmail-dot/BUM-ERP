// Mavzu (qorong'i/yorug') sinfini React yuklanishidan oldin qo'yadi — sahifa miltillamaydi (FOUC).
// Alohida fayl: Content-Security-Policy inline skriptlarni taqiqlaydi (script-src 'self').
try {
  var theme = localStorage.getItem("theme");
  if (theme === "system" || !theme) {
    theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.classList.add(theme);
} catch (e) {}
