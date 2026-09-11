import { cn } from "@/lib/utils.ts";
import { useProductImageUrl } from "./product-files.ts";

type Props = {
  productId: string;
  imageKey: string | null;
  alt: string;
  className?: string;
  /** Rasm bo'lmaganda (yoki URL olinmaganda) ko'rsatiladi. */
  fallback: React.ReactNode;
};

export function ProductImage({ productId, imageKey, alt, className, fallback }: Props) {
  const url = useProductImageUrl(productId, imageKey);
  if (!url) return <>{fallback}</>;
  return <img src={url} alt={alt} className={cn("object-cover", className)} />;
}
