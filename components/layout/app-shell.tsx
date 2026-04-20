"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PropsWithChildren, useMemo, useState } from "react";

const tabs = [
  { href: "/", label: "Home" },
  { href: "/today", label: "Today" },
  { href: "/board", label: "Board" },
  { href: "/blocks", label: "Blocks" },
  { href: "/upcoming", label: "Upcoming" },
  { href: "/insights", label: "Insights" },
];

export function AppShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/signup");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  });

  const activeHref = useMemo(() => {
    if (pathname === "/") return "/";
    if (pathname.startsWith("/today")) return "/today";
    if (pathname.startsWith("/board")) return "/board";
    if (pathname.startsWith("/blocks")) return "/blocks";
    if (pathname.startsWith("/upcoming")) return "/upcoming";
    if (pathname.startsWith("/insights")) return "/insights";
    return "";
  }, [pathname]);

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    setTheme(nextTheme);
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  };

  if (isAuthPage) {
    return <main className="mx-auto w-full max-w-[1040px] px-6 pb-14 pt-10">{children}</main>;
  }

  return (
    <>
      <nav
        className="sticky top-0 z-50 border-b backdrop-blur-xl"
        style={{ background: "var(--surface)", borderColor: "var(--line)" }}
      >
        <div className="mx-auto flex h-14 w-full max-w-[1040px] items-center justify-between px-6">
          <div className="text-base font-bold tracking-[-0.02em]">TaskPilot</div>

          <div className="flex gap-0.5">
            {tabs.map((tab) => {
              const isActive = activeHref === tab.href;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className="rounded-[10px] px-3.5 py-1.5 text-[0.86rem] font-medium transition-colors"
                  style={{
                    color: isActive ? "var(--accent)" : "var(--text-2)",
                    background: isActive ? "var(--accent-soft)" : "transparent",
                  }}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-[10px] px-3 py-1.5 text-[0.82rem] font-medium transition-colors"
              style={{ color: "var(--text-2)", background: "transparent" }}
            >
              Logout
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              className="relative h-6 w-10 rounded-full transition-colors"
              style={{ background: "var(--toggle-bg)" }}
            >
              <span
                className="absolute left-[3px] top-[3px] h-[18px] w-[18px] rounded-full transition-transform"
                style={{
                  background: "var(--toggle-knob)",
                  transform: theme === "dark" ? "translateX(16px)" : "translateX(0)",
                }}
              />
            </button>
            <div className="h-[30px] w-[30px] rounded-full bg-gradient-to-br from-[#007aff] to-[#5856d6]" />
          </div>
        </div>
      </nav>

      <main className="mx-auto w-full max-w-[1040px] px-6 pb-14 pt-10">{children}</main>
    </>
  );
}
