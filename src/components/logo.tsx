import { cn } from "@/lib/utils";

// Split Tile mark: one format goes in (`{`), another comes out (`>`)
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" fill="none" aria-hidden="true" className={className}>
      <path
        d="M60 8H32A24 24 0 0 0 8 32V88A24 24 0 0 0 32 112H60Z"
        fill="currentColor"
      />
      <path
        d="M60 8H88A24 24 0 0 1 112 32V88A24 24 0 0 1 88 112H60Z"
        className="fill-primary"
      />
      <path
        d="M42 36C33 36 33 41 33 48V53C33 57 30 60 25 60C30 60 33 63 33 67V72C33 79 33 84 42 84"
        className="stroke-background"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M78 40L94 60L78 80"
        className="stroke-primary-foreground"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <a
      href="/"
      aria-label="ParseBox home"
      className={cn("flex items-center gap-2.5 text-foreground", className)}
    >
      <LogoMark className="h-7 w-7" />
      <span className="text-[19px] font-semibold tracking-[-0.03em]">
        parse<span className="text-primary">box</span>
      </span>
    </a>
  );
}
