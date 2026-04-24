"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PropsWithChildren, useState } from "react";

/**
 * App chrome — intentionally minimal.
 *
 * This used to host a sticky 4-step Plan/Schedule/Focus/Reflect stepper
 * plus a step-counted CTA pill in the nav. Both reinforced a forced-
 * progression feel that no longer matches the product: the planner
 * already prepares the day, so the chrome should just navigate, not
 * narrate where the user "should" be.
 *
 * What's left here:
 *   - Brand mark
 *   - Plain top-level links (Home / Today / Tasks)
 *   - Theme toggle + logout
 *
 * The page itself answers "what's next?" via its own hero card.
 */
export function AppShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/signup");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof document === "undefined") return "light";
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  });

  const isHomeActive = pathname === "/";
  const isTodayActive = pathname.startsWith("/blocks");
  const isTasksActive = pathname.startsWith("/tasks");

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

          <div className="flex items-center gap-1">
            <NavLink href="/" label="Home" active={isHomeActive} />
            <NavLink href="/blocks" label="Today" active={isTodayActive} primary />
            <NavLink href="/tasks" label="Tasks" active={isTasksActive} />
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

      <main className="mx-auto w-full max-w-[1280px] px-6 pb-14 pt-10">{children}</main>
    </>
  );
}

/**
 * One styled nav link. `primary` lifts the "Today" entry visually so the
 * day-execution page is always one obvious click away — without resorting
 * to a step-counted progression badge.
 */
function NavLink({
  href,
  label,
  active,
  primary = false,
}: {
  href: string;
  label: string;
  active: boolean;
  primary?: boolean;
}) {
  if (primary) {
    return (
      <Link
        href={href}
        className="ml-1 inline-flex h-9 items-center rounded-full px-4 text-[0.84rem] font-semibold transition-colors"
        style={{
          background: active ? "var(--accent)" : "var(--accent-soft)",
          color: active ? "#fff" : "var(--accent)",
        }}
      >
        {label}
      </Link>
    );
  }
  return (
    <Link
      href={href}
      className="rounded-[10px] px-3.5 py-1.5 text-[0.86rem] font-medium transition-colors hover:text-[var(--text)]"
      style={{
        color: active ? "var(--accent)" : "var(--text-2)",
        background: active ? "var(--accent-soft)" : "transparent",
      }}
    >
      {label}
    </Link>
  );
}
