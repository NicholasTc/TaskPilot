const week = [
  { day: "Mon", value: "4/4", height: "100%" },
  { day: "Tue", value: "3/5", height: "60%" },
  { day: "Wed", value: "1/6", height: "17%", today: true },
  { day: "Thu", value: "0/3", height: "0%" },
  { day: "Fri", value: "0/2", height: "0%" },
  { day: "Sat", value: "—", height: "0%" },
  { day: "Sun", value: "—", height: "0%" },
];

const upcoming = [
  { name: "Finish TypeScript assignment", meta: "Due today", due: "Today", tone: "urgent" },
  { name: "Submit lab report", meta: "11:59 PM", due: "Tomorrow", tone: "urgent" },
  { name: "Review math notes for quiz", due: "Friday", tone: "soon" },
  { name: "Read 20 pages of biology textbook", meta: "Chapter 7", due: "Next Mon", tone: "later" },
  { name: "Prepare presentation slides", due: "Next Wed", tone: "later" },
];

const reminders = [
  { name: "Group meeting", detail: "Study room B", time: "Today, 6 PM" },
  { name: "Office hours — Prof. Lee", detail: "Building C, Room 204", time: "Thu, 2 PM" },
  { name: "Dentist", detail: "Downtown clinic", time: "Sat, 10 AM" },
];

export default function HomePage() {
  return (
    <div>
      <section className="mb-10">
        <h1 className="text-[2.25rem] font-bold leading-[1.1] tracking-[-0.035em]">
          Welcome back, Nicholas
        </h1>
        <p className="mt-2.5 text-base" style={{ color: "var(--text-2)" }}>
          You&apos;re 65% through the week — solid pace, keep it going.
        </p>
      </section>

      <section
        className="mb-10 flex cursor-pointer items-center justify-between gap-6 rounded-[18px] border px-10 py-6 shadow-[var(--shadow-md)] transition"
        style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
      >
        <div>
          <p
            className="text-[0.78rem] font-semibold uppercase tracking-[0.04em]"
            style={{ color: "var(--accent)" }}
          >
            Today — Wednesday
          </p>
          <h2 className="mt-1.5 text-2xl font-bold tracking-[-0.025em]">5 tasks remaining</h2>
          <p className="mt-1 text-[0.92rem]" style={{ color: "var(--text-2)" }}>
            1 completed so far
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end gap-2">
            <div
              className="h-2 w-[140px] overflow-hidden rounded-full"
              style={{ background: "var(--line)" }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: "17%",
                  background: "linear-gradient(90deg, var(--done), #4cd964)",
                }}
              />
            </div>
            <p className="text-[0.82rem] font-semibold" style={{ color: "var(--text-2)" }}>
              <span style={{ color: "var(--done)" }}>1</span> / 6 done
            </p>
          </div>
          <div className="grid h-11 w-11 place-items-center rounded-full bg-[var(--accent)]">
            <svg viewBox="0 0 16 16" className="h-4 w-4 fill-white">
              <path d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z" />
            </svg>
          </div>
        </div>
      </section>

      <section
        className="mb-10 rounded-[18px] border px-6 py-6 shadow-[var(--shadow-md)]"
        style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
      >
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold tracking-[-0.01em]">This week</h3>
          <span className="text-[0.82rem]" style={{ color: "var(--text-3)" }}>
            April 13 – 19
          </span>
        </header>
        <div className="grid grid-cols-7 gap-2">
          {week.map((item) => (
            <div
              key={item.day}
              className="rounded-[10px] px-1 py-2 text-center transition"
              style={{ background: item.today ? "var(--accent-soft)" : "transparent" }}
            >
              <p
                className="mb-2.5 text-[0.72rem] font-semibold uppercase tracking-[0.02em]"
                style={{ color: item.today ? "var(--accent)" : "var(--text-3)" }}
              >
                {item.day}
              </p>
              <div
                className="flex h-14 flex-col justify-end overflow-hidden rounded-lg"
                style={{
                  background: "var(--line)",
                  outline: item.today ? "2px solid var(--accent)" : "none",
                  outlineOffset: item.today ? "-2px" : "0",
                }}
              >
                <div
                  className="rounded-lg bg-[var(--done)]"
                  style={{ height: item.height, minHeight: item.height === "0%" ? "0" : "4px" }}
                />
              </div>
              <p
                className="mt-2 text-[0.76rem] font-medium"
                style={{ color: item.today ? "var(--accent)" : "var(--text-2)" }}
              >
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-[1.4fr_1fr] gap-10 max-[880px]:grid-cols-1">
        <section>
          <h2 className="mb-4 text-[1.25rem] font-bold tracking-[-0.02em]">Upcoming</h2>
          <div>
            {upcoming.map((item, idx) => (
              <article
                key={item.name}
                className="mx-[-12px] flex items-center gap-3 rounded-[10px] border-b px-3 py-[14px] transition hover:bg-[var(--surface-hover)]"
                style={{ borderBottomColor: idx === upcoming.length - 1 ? "transparent" : "var(--line)" }}
              >
                <button
                  type="button"
                  aria-label={`Toggle ${item.name}`}
                  className="h-[22px] w-[22px] flex-shrink-0 rounded-full border-2 transition"
                  style={{ borderColor: "var(--text-3)" }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[0.96rem] font-medium">{item.name}</p>
                  {item.meta ? (
                    <p className="mt-0.5 text-[0.8rem]" style={{ color: "var(--text-3)" }}>
                      {item.meta}
                    </p>
                  ) : null}
                </div>
                <span
                  className="whitespace-nowrap rounded-full px-2.5 py-1 text-[0.76rem] font-semibold"
                  style={{
                    background:
                      item.tone === "urgent"
                        ? "rgba(255, 59, 48, 0.1)"
                        : item.tone === "soon"
                          ? "rgba(255, 149, 0, 0.1)"
                          : "var(--line)",
                    color:
                      item.tone === "urgent"
                        ? "var(--danger)"
                        : item.tone === "soon"
                          ? "#ff9500"
                          : "var(--text-3)",
                  }}
                >
                  {item.due}
                </span>
              </article>
            ))}
          </div>
        </section>

        <aside
          className="rounded-[18px] border px-6 py-6 shadow-[var(--shadow-md)]"
          style={{ background: "var(--surface-solid)", borderColor: "var(--line)" }}
        >
          <h3
            className="mb-4 text-[0.78rem] font-semibold uppercase tracking-[0.04em]"
            style={{ color: "var(--text-3)" }}
          >
            Reminders
          </h3>
          {reminders.map((reminder, idx) => (
            <article
              key={reminder.name}
              className="flex items-start justify-between gap-3 border-b py-3"
              style={{ borderBottomColor: idx === reminders.length - 1 ? "transparent" : "var(--line)" }}
            >
              <div>
                <p className="text-[0.92rem] font-medium">{reminder.name}</p>
                <p className="mt-0.5 text-[0.8rem]" style={{ color: "var(--text-3)" }}>
                  {reminder.detail}
                </p>
              </div>
              <span className="pt-0.5 text-[0.8rem] whitespace-nowrap" style={{ color: "var(--text-3)" }}>
                {reminder.time}
              </span>
            </article>
          ))}
        </aside>
      </div>
    </div>
  );
}
