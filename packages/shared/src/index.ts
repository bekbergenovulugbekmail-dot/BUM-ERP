// `.ts` kengaytmasi ataylab: production'da API (`node dist/server.js`) bu paketni build'siz,
// Node'ning type stripping'i bilan yuklaydi — shuning uchun faqat o'chiriladigan TS sintaksisi
// (enum, namespace, konstruktor parametr-xossalari yo'q).
export * from "./permissions.ts";
export * from "./errors.ts";
export * from "./phone.ts";
