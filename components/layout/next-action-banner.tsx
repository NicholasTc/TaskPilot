"use client";

import Link from "next/link";
import { ReactNode } from "react";

type Tone = "accent" | "warn" | "done" | "neutral";

const toneStyles: Record<Tone, { bg: string; border: string; text: string; iconBg: string; iconColor: string }> = {
  accent: {
    bg: "var(--accent-soft)",
    border: "var(--accent)",
    text: "var(--accent)",
    iconBg: "var(--accent)",
    iconColor: "#fff",
  },
  warn: {
    bg: "var(--warn-soft)",
    border: "var(--warn)",
    text: "var(--warn)",
    iconBg: "var(--warn)",
    iconColor: "#fff",
  },
  done: {
    bg: "var(--done-soft)",
    border: "var(--done)",
    text: "var(--done)",
    iconBg: "var(--done)",
    iconColor: "#fff",
  },
  neutral: {
    bg: "var(--surface-solid)",
    border: "var(--line-strong)",
    text: "var(--text-2)",
    iconBg: "var(--line-strong)",
    iconColor: "var(--text)",
  },
};

type NextActionBannerProps = {
  step: number;
  eyebrow: string;
  title: string;
  description: ReactNode;
  ctaLabel?: string;
  ctaHref?: string;
  onCtaClick?: () => void;
  ctaDisabled?: boolean;
  tone?: Tone;
  secondary?: ReactNode;
};

/**
 * Per-page hero banner that answers "what's the ONE thing to do here?"
 * Lives directly under the flow strip, above the page's existing header.
 */
export function NextActionBanner({
  step,
  eyebrow,
  title,
  description,
  ctaLabel,
  ctaHref,
  onCtaClick,
  ctaDisabled,
  tone = "accent",
  secondary,
}: NextActionBannerProps) {
  const t = toneStyles[tone];

  const cta = ctaLabel ? (
    ctaHref ? (
      <Link
        href={ctaHref}
        className="inline-flex h-10 items-center gap-1.5 rounded-[12px] px-5 text-[0.88rem] font-semibold text-white transition active:scale-[0.98]"
        style={{ background: t.iconBg, opacity: ctaDisabled ? 0.55 : 1, pointerEvents: ctaDisabled ? "none" : "auto" }}
      >
        {ctaLabel}
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 4l4 4-4 4" />
        </svg>
      </Link>
    ) : (
      <button
        type="button"
        onClick={onCtaClick}
        disabled={ctaDisabled}
        className="inline-flex h-10 items-center gap-1.5 rounded-[12px] px-5 text-[0.88rem] font-semibold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55"
        style={{ background: t.iconBg }}
      >
        {ctaLabel}
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 4l4 4-4 4" />
        </svg>
      </button>
    )
  ) : null;

  return (
    <section
      className="anim mb-5 grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-[16px] border-l-[3px] px-5 py-4 max-[720px]:grid-cols-1"
      style={{
        background: t.bg,
        borderLeftColor: t.border,
        border: `1px solid ${t.border}`,
        borderLeftWidth: 3,
      }}
    >
      <div
        className="grid h-9 w-9 place-items-center rounded-full text-[0.78rem] font-bold"
        style={{ background: t.iconBg, color: t.iconColor }}
      >
        {step}
      </div>
      <div className="min-w-0">
        <p
          className="text-[0.7rem] font-semibold uppercase tracking-[0.06em]"
          style={{ color: t.text }}
        >
          {eyebrow}
        </p>
        <h2 className="mt-0.5 text-[1.05rem] font-semibold tracking-[-0.01em]">{title}</h2>
        <div className="mt-1 text-[0.86rem]" style={{ color: "var(--text-2)" }}>
          {description}
        </div>
      </div>
      <div className="flex items-center gap-2 max-[720px]:w-full max-[720px]:justify-start">
        {secondary}
        {cta}
      </div>
    </section>
  );
}
