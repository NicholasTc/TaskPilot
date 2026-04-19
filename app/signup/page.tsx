"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Unable to sign up.");
      }

      router.push("/today");
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to sign up.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto mt-20 w-full max-w-md rounded-[18px] border px-8 py-8 shadow-[var(--shadow-md)]" style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}>
      <h1 className="text-[2rem] font-bold tracking-[-0.03em]">Create account</h1>
      <p className="mt-2 text-[0.92rem]" style={{ color: "var(--text-2)" }}>
        Sign up to start using TaskPilot.
      </p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-1 block text-[0.82rem] font-medium" style={{ color: "var(--text-2)" }}>
            Email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="min-h-12 w-full rounded-[14px] border px-4 text-[0.95rem] outline-none transition focus:ring-4"
            style={{
              borderColor: "var(--line)",
              background: "var(--surface-solid)",
              color: "var(--text)",
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-[0.82rem] font-medium" style={{ color: "var(--text-2)" }}>
            Password
          </label>
          <input
            type={showPassword ? "text" : "password"}
            minLength={8}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="min-h-12 w-full rounded-[14px] border px-4 text-[0.95rem] outline-none transition focus:ring-4"
            style={{
              borderColor: "var(--line)",
              background: "var(--surface-solid)",
              color: "var(--text)",
            }}
          />
          <p className="mt-1 text-[0.75rem]" style={{ color: "var(--text-3)" }}>
            Use at least 8 characters.
          </p>
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="mt-2 text-[0.82rem] font-medium transition"
            style={{ color: "var(--accent)" }}
          >
            {showPassword ? "Hide password" : "View password"}
          </button>
        </div>

        {errorMessage ? (
          <p className="text-[0.84rem]" style={{ color: "var(--danger)" }}>
            {errorMessage}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="min-h-12 w-full rounded-[14px] px-6 text-[0.92rem] font-semibold text-white transition active:scale-[0.97]"
          style={{
            background: "var(--accent)",
            boxShadow: "0 1px 2px rgba(0, 122, 255, 0.25)",
            opacity: isSubmitting ? 0.7 : 1,
          }}
        >
          {isSubmitting ? "Creating account..." : "Sign up"}
        </button>
      </form>

      <p className="mt-5 text-[0.88rem]" style={{ color: "var(--text-2)" }}>
        Already have an account?{" "}
        <Link href="/login" style={{ color: "var(--accent)" }}>
          Log in
        </Link>
      </p>
    </div>
  );
}
