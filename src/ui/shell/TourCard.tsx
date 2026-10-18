import { useCommands, useCosmos, useCosmosShallow } from '../hooks';
import { useUiExtensions } from '../context';
import { Button } from '../components/Button';
import { Kbd } from '../components/Kbd';

function Magnitude({ log10 }: { log10: number }) {
  const e = Math.round(log10);
  return (
    <span className="cx-tour__index" aria-label={`Chapter scale 10 to the ${e} meters`}>
      10<sup>{e < 0 ? `−${-e}` : e}</sup> m
    </span>
  );
}

/** Exhibition-mode chapter card in the left column: index by order of magnitude, Atlas title, narration. */
export function TourCard() {
  const tour = useCosmosShallow(s => ({ id: s.tour.activeId, step: s.tour.step, count: s.tour.stepCount }));
  const scale = useCosmos(s => s.view.scaleLog10);
  const ext = useUiExtensions();
  const commands = useCommands();
  if (!tour.id) return null;
  let content = null;
  try {
    content = ext.tourStep?.(tour.id, tour.step) ?? null;
  } catch {
    content = null;
  }
  const last = tour.step >= tour.count - 1;
  return (
    <section className="cx-tour" aria-label="Guided tour" aria-live="polite">
      <p className="cx-tour__meta">
        <Magnitude log10={content?.scaleLog10 ?? scale} />
        <span className="cx-tour__count cx-num">
          Chapter {tour.step + 1} of {Math.max(tour.count, tour.step + 1)}
        </span>
      </p>
      <h1 className="cx-tour__title">{content?.title ?? 'Guided tour'}</h1>
      {content?.narration && <p className="cx-tour__narration">{content.narration}</p>}
      <div className="cx-tour__nav">
        <Button variant="quiet" disabled={tour.step === 0} onClick={() => commands.tourPrev()}>Previous</Button>
        <Button variant="primary" onClick={() => (last ? commands.exitTour() : commands.tourNext())}>{last ? 'Finish tour' : 'Next chapter'}</Button>
      </div>
      <div className="cx-tour__nav cx-tour__nav--secondary">
        <Button variant="secondary" onClick={() => commands.tourRestartStep()}>Return to demo</Button>
        <Button variant="quiet" onClick={() => commands.exitTour()}>Exit tour</Button>
      </div>
      <p className="cx-tour__keys" aria-hidden="true">
        <span><Kbd keys="ArrowRight" size="sm" /> next</span>
        <span><Kbd keys="ArrowLeft" size="sm" /> previous</span>
        <span><Kbd keys="R" size="sm" /> return to demo</span>
        {content?.hint && <span>{content.hint}</span>}
      </p>
    </section>
  );
}
