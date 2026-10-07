import { Logo } from "../logo";
import { appConfig } from "@/config/app";
import { formatCount } from "@/config/formats";

export function Header() {
  return (
    <header className="w-full border-b bg-background">
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 md:px-7">
        <Logo />
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
          <span>{formatCount} formats</span>
          <span className="flex items-center gap-1.5">
            <span className="h-[7px] w-[7px] rounded-full bg-success" aria-hidden="true" />
            local only — nothing leaves your browser
          </span>
          <a
            href={appConfig.author.url}
            target="_blank"
            rel="noreferrer"
            className="text-[#FF8A5C] underline-offset-4 hover:underline"
          >
            buy me a coffee
          </a>
        </nav>
      </div>
    </header>
  );
}
