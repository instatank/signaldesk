// Fear & Greed: big color-coded number, 30-day sparkline with the
// extreme zones shaded, and the canned contrarian guidance.
import { Card, Explainer, Sparkline, TONE_TEXT, Unavailable } from './ui.js';

const STROKES = {
  red: '#f87171',
  amber: '#fbbf24',
  gray: '#a1a1aa',
  lime: '#a3e635',
  green: '#34d399',
};

const FNG_EXPLAINER = (
  <>
    <p className="mb-1 font-medium text-zinc-100">Fear &amp; Greed — the crowd&rsquo;s mood, 0–100</p>
    <p>
      Blends volatility, volume, social buzz and dominance into one number. The beginner lesson it
      teaches: sentiment extremes are contrarian. Historically, extreme fear (&lt;20) marked better
      buying zones than selling zones, and extreme greed (&gt;80) is when to be careful, not FOMO.
    </p>
  </>
);

export default function FearGreedCard({ fearGreed }) {
  return (
    <Card title="Fear & Greed" right={<Explainer label="Fear and Greed index">{FNG_EXPLAINER}</Explainer>}>
      {!fearGreed ? (
        <Unavailable what="Sentiment data" />
      ) : (
        <div>
          <div className="flex items-baseline gap-3">
            <span className={`text-5xl font-bold tabular-nums ${TONE_TEXT[fearGreed.tone]}`}>
              {fearGreed.value}
            </span>
            <span className="text-sm font-medium text-zinc-300">{fearGreed.classification}</span>
          </div>
          {fearGreed.history.length >= 2 && (
            <div className="mt-3">
              <Sparkline
                values={fearGreed.history}
                stroke={STROKES[fearGreed.tone]}
                extremes={{ low: 20, high: 80 }}
              />
              <div className="mt-1 flex justify-between text-[10px] uppercase tracking-widest text-zinc-600">
                <span>30 days ago</span>
                <span>today</span>
              </div>
            </div>
          )}
          <p className="mt-3 text-xs leading-relaxed text-zinc-400">{fearGreed.guidance}</p>
        </div>
      )}
    </Card>
  );
}
