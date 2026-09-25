import Link from "next/link";

const steps = [
  { icon: "📍", title: "Add your places", text: "Office, home, the gym — plus the weekdays you're usually there." },
  { icon: "🔎", title: "We scan nearby", text: "Restaurant lunch menus, Willys/Hemköp deals and fast food chain offers around each place." },
  { icon: "🗓️", title: "Get your week", text: "One digest per week: what's for lunch each day, the best grocery savings and fast food deals." },
];

export default function Home() {
  return (
    <div className="space-y-16 py-8">
      <section className="text-center space-y-6">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
          Stop hunting for lunch deals.
          <br />
          <span className="text-brand">Get your food week in one place.</span>
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-muted">
          WeekBite collects this week&apos;s lunch menus, grocery offers and fast food deals around the places you actually spend your
          week, and summarizes them for you.
        </p>
        <div className="flex justify-center gap-3">
          <Link href="/signup" className="btn px-6 py-3 text-base">Create free account</Link>
          <Link href="/login" className="btn-ghost px-6 py-3 text-base">Log in</Link>
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        {steps.map((s) => (
          <div key={s.title} className="card p-6 space-y-2">
            <div className="text-3xl">{s.icon}</div>
            <h2 className="font-semibold">{s.title}</h2>
            <p className="text-sm text-muted">{s.text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
