import {
  changeLocale,
  isSupportedLocale,
  SAVED_OR_DEFAULT_LOCALE,
  setLocaleInPath,
  type SupportedLocale,
} from "@/i18n.ts";
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation, useParams } from "react-router-dom";

export default function LocaleWrapper({ children }: { children: ReactNode }) {
  const { lng } = useParams<{ lng: string }>();
  const { i18n } = useTranslation();
  const location = useLocation();

  useEffect(() => {
    if (lng && isSupportedLocale(lng) && i18n.language !== lng) {
      void changeLocale(lng as SupportedLocale);
    }
  }, [lng, i18n]);

  if (lng && lng !== lng.toLowerCase()) {
    const redirectPath = setLocaleInPath(
      lng.toLowerCase(),
      location.pathname,
      location.search,
      location.hash,
    );
    return <Navigate to={redirectPath} replace />;
  }

  if (!lng || !isSupportedLocale(lng)) {
    const redirectPath = setLocaleInPath(
      SAVED_OR_DEFAULT_LOCALE,
      location.pathname,
      location.search,
      location.hash,
    );
    return <Navigate to={redirectPath} replace />;
  }

  return <>{children}</>;
}
