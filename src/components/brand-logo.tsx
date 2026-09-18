/**
 * BUM logotipi — bitta joydan.
 *
 * Ikki ko'rinish: `mark` (faqat belgi, tor joylar uchun) va `full` (belgi + "BUM" yozuvi).
 * Fayllar `public/brand/` da; rasm shaffof fonli, shuning uchun yorug' va qorong'i mavzuda ham ishlaydi.
 */
import { cn } from "@/lib/utils.ts";

const SRC = {
  mark: "/brand/bum-mark.png",
  full: "/brand/bum-logo.png",
} as const;

export default function BrandLogo({
  variant = "mark",
  className,
  alt = "BUM ERP",
}: {
  variant?: keyof typeof SRC;
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src={SRC[variant]}
      alt={alt}
      // Yuklanmaguncha joy sakramasin
      width={variant === "mark" ? 202 : 475}
      height={variant === "mark" ? 256 : 512}
      className={cn("object-contain", className)}
      draggable={false}
    />
  );
}
