"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PropsWithChildren, useEffect, useMemo, useState } from "react";
import { DailyFlow, getStepLabel, getStepRoute } from "@/lib/daily-flow";
import { FlowStrip } from "./flow-strip";

export function AppShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/signup");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  });
  const [flow, setFlow] = useState<DailyFlow | null>(null);

  const isHomeActive = pathname === "/";
  const isTasksActive = pathname.startsWith("/tasks");
  const isBlocksActive = pathname.startsWith("/blocks");
  const isInFlow =
    pathname.startsWith("/tasks") ||
    pathname.startsWith("/blocks") ||
    pathname.startsWith("/today");

  useEffect(() => {
    if (isAuthPage) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/daily-flow");
        if (!response.ok) return;
        const data = (await response.json()) as DailyFlow;
        if (!cancelled) setFlow(data);
      } catch {
        // silent
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthPage, pathname]);

  const startDayCopy = useMemo(() => {
    if (!flow || !flow.hasStarted) {
      // Day hasn't been planned yet → point at the dump-and-go entry.
      return { label: "Start Day", badge: null as string | null, href: "/tasks" };
    }
    const meta = getStepLabel(flow.step);
    return {
      label: "Continue Day",
      badge: `Step ${meta.num}`,
      href: getStepRoute(flow.step),
    };
  }, [flow]);

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
        <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center justify-between px-6">
          <Link href="/" className="text-base font-bold tracking-[-0.02em]">
            TaskPilot
          </Link>

          <div className="flex items-center gap-1.5">
            <Link
              href="/"
              className="rounded-[10px] px-3.5 py-1.5 text-[0.86rem] font-medium transition-colors hover:text-[var(--text)]"
              style={{
                color: isHomeActive ? "var(--accent)" : "var(--text-2)",
                background: isHomeActive ? "var(--accent-soft)" : "transparent",
              }}
            >
              Home
            </Link>

            <Link
              href={startDayCopy.href}
              className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-[0.84rem] font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
              style={{
                background: "var(--accent)",
                boxShadow: isInFlow ? "0 0 0 3px var(--accent-soft)" : "0 1px 2px rgba(0,122,255,0.25)",
              }}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{
                  background: "#fff",
                  animation: flow?.hasStarted ? "pulseDot 1.5s ease-in-out infinite" : undefined,
                }}
              />
              {startDayCopy.label}
              {startDayCopy.badge ? (
                <span
                  className="rounded-full px-1.5 py-[1px] text-[0.66rem] font-semibold"
                  style={{ background: "rgba(255,255,255,0.22)" }}
                >
                  {startDayCopy.badge}
                </span>
              ) : null}
            </Link>

            <Link
              href="/tasks"
              className="rounded-[10px] px-3.5 py-1.5 text-[0.86rem] font-medium transition-colors hover:text-[var(--text)]"
              style={{
                color: isTasksActive ? "var(--accent)" : "var(--text-2)",
                background: isTasksActive ? "var(--accent-soft)" : "transparent",
              }}
            >
              Tasks
            </Link>
            <Link
              href="/blocks"
              className="rounded-[10px] px-3.5 py-1.5 text-[0.86rem] font-medium transition-colors hover:text-[var(--text)]"
              style={{
                color: isBlocksActive ? "var(--accent)" : "var(--text-2)",
                background: isBlocksActive ? "var(--accent-soft)" : "transparent",
              }}
            >
              Study Blocks
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleLogout}
              className="h-[30px] rounded-[8px] border px-3 text-[0.82rem] font-medium transition-colors hover:text-[var(--text)]"
              style={{ borderColor: "var(--line)", color: "var(--text-2)", background: "transparent" }}
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
                  boxShadow: "0 1px 3px rgba(0,0,0,.2)",
                }}
              />
            </button>
            <div className="h-[30px] w-[30px] rounded-full bg-gradient-to-br from-[#007aff] to-[#5856d6]" />
          </div>
        </div>
      </nav>

      <FlowStrip />

      <main className="mx-auto w-full max-w-[1280px] px-6 pb-14 pt-10">{children}</main>
    </>
  );
}
