import Image from "next/image";

export function BrandLogo({
  variant = "light",
  className = "",
  priority = false,
}: {
  variant?: "light" | "ink";
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/brand/lyftt-logo-white.png"
      alt="LYFTT"
      width={800}
      height={490}
      priority={priority}
      draggable={false}
      className={`brand-logo-image ${variant === "ink" ? "brand-logo-image--ink" : ""} ${className}`}
    />
  );
}
