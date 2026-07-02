// Phase 1 placeholder. The product right now is the pipeline + Telegram
// digest. The dashboard (three cards + briefing) is Phase 2, built only
// after the owner has validated the digest for a few days.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-bold tracking-tight">SignalDesk</h1>
      <p className="text-zinc-400">
        Pipeline is live. Your daily briefing arrives on Telegram at 07:00 IST.
      </p>
      <p className="text-sm text-zinc-600">Dashboard coming in Phase 2.</p>
    </main>
  );
}
