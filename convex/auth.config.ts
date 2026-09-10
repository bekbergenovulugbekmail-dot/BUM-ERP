/**
 * Convex Auth o'zi token chiqaradi va o'zi tekshiradi — tashqi OIDC
 * provayder (Hercules / Logto) endi ishlatilmaydi.
 */
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
