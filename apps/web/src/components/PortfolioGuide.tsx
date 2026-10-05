export function PortfolioGuide() {
  return (
    <details className="group fixed left-4 top-4 z-[40000] max-w-[calc(100vw-2rem)] text-slate-100">
      <summary className="cursor-pointer list-none rounded-full border border-sky-200/30 bg-slate-950/85 px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur transition hover:border-sky-200/60 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300">
        <span aria-hidden="true" className="mr-1.5 text-sky-300">✦</span>
        Portfolio tour
      </summary>

      <article className="mt-2 w-[min(25rem,calc(100vw-2rem))] rounded-2xl border border-sky-200/20 bg-slate-950/95 p-5 shadow-2xl backdrop-blur-xl">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-300">
          PenguinHQ · Engineering case study
        </p>
        <h1 className="mt-2 text-xl font-bold tracking-tight text-white">
          A multi-agent AI system you can watch.
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Four autonomous agents coordinate through a persisted task ledger while a typed WebSocket
          stream projects their work into this interactive office.
        </p>

        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-white/10 bg-white/5 p-2">
            <dt className="text-lg font-bold text-sky-300">4</dt>
            <dd className="text-[10px] text-slate-400">specialists</dd>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-2">
            <dt className="text-lg font-bold text-violet-300">2</dt>
            <dd className="text-[10px] text-slate-400">dispatch paths</dd>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-2">
            <dt className="text-lg font-bold text-emerald-300">9</dt>
            <dd className="text-[10px] text-slate-400">frontend tests</dd>
          </div>
        </dl>

        <div className="mt-4 space-y-2 text-xs leading-5 text-slate-300">
          <p><strong className="text-white">Try it:</strong> move Watty with WASD, drag furniture, select the coffee nook, or open the Leetcode channel.</p>
          <p><strong className="text-white">Built with:</strong> Next.js, FastAPI, PostgreSQL, Redis, MCP, Zustand, and Docker Compose.</p>
        </div>

        <a
          href="https://github.com/sparkling-snail/penguinhq"
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex rounded-lg bg-sky-400 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
        >
          View source on GitHub
        </a>
      </article>
    </details>
  );
}
