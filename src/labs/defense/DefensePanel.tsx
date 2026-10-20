import { useMemo, useState, type ReactNode } from 'react';
import type { LabPanelProps } from '../../ui/labs/registry';
import { LabShell, type LabCompareRow, type LabResult } from '../../ui/labs/LabShell';
import { Slider } from '../../ui/components/Slider';
import { SegmentedControl } from '../../ui/components/SegmentedControl';
import { Equation } from '../../ui/components/Equation';
import { ProvenanceBadge } from '../../ui/components/Provenance';
import { useReducedMotion } from '../../ui/hooks';
import type { ProvenanceClass } from '../../data/provenance';
import { DART_CALIBRATION, IMPACT_MODELS } from '../../science/impact';
import type { ModelInfo } from '../../science/models';
import {
  DART_ALONG_TRACK_FACTOR, DART_BETA_SIGMA, DART_IMPACT_UTC, DART_REAL, DIMORPHOS_DENSITY_KGM3, EARTH_DEFAULT, EARTH_ESCAPE_MS,
  EARTH_RADIUS_M, EARTH_UNCERTAINTY, MODELS_USED, dartModified, dartScenario, earthScenario, outcomeOf,
  type DartInputs, type EarthInputs, type EarthResult,
} from './model';
import { DartReplay } from './DartReplay';
import { BPlane, WarningChart } from './BPlane';
import { diff, dist, fixed, mass, minutes, percent, sci, sig, speed, years } from './format';
import './defense.css';

type Part = 'dart' | 'earth';

const SRC = {
  cheng: 'Cheng et al. 2023, Nature 616, 457',
  thomas: 'Thomas et al. 2023, Nature 616, 448',
  daly: 'Daly et al. 2023, Nature 616, 443',
  rivkin: 'Rivkin et al. 2021, PSJ 2, 173',
};

function Fact({ label, value, kind, source }: { label: string; value: ReactNode; kind: ProvenanceClass; source: string }) {
  return (
    <div className="cx-fact">
      <span className="cx-fact__label">{label}</span>
      <span className="cx-fact__value">
        <ProvenanceBadge kind={kind} showLabel={false} detail={source} />
        <span className="cx-num">{value}</span>
      </span>
      <span className="cx-dfn-src">{source}</span>
    </div>
  );
}

function ModelNotes({ ids, extra }: { ids: string[]; extra?: string[] }) {
  const models = IMPACT_MODELS.filter(m => ids.includes(m.id));
  return (
    <div className="cx-dfn-models">
      {models.map((m: ModelInfo) => (
        <section key={m.id} className="cx-dfn-model">
          <h4 className="cx-dfn-model__title">{m.title} <span className="cx-id">{m.id}@{m.version}</span></h4>
          <ul className="cx-dfn-list">{m.assumptions.map(a => <li key={a}>{a}</li>)}</ul>
          <p className="cx-dfn-note">Valid: {m.validity}</p>
          <ul className="cx-dfn-refs">
            {m.references.map(r => (
              <li key={r.citation}>
                {r.citation}
                {r.doi && <> <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer" className="cx-id">doi:{r.doi}</a></>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {extra && extra.length > 0 && (
        <section className="cx-dfn-model">
          <h4 className="cx-dfn-model__title">This lab</h4>
          <ul className="cx-dfn-list">{extra.map(a => <li key={a}>{a}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

// ── Part 1 ──────────────────────────────────────────────────────────────────────────────────────────

function useDart(inp: DartInputs) {
  return useMemo(() => dartScenario(inp, 2000), [inp]);
}

// ── Panel ───────────────────────────────────────────────────────────────────────────────────────────

export function DefensePanel({ onClose, params }: LabPanelProps) {
  const reduced = useReducedMotion();
  const [part, setPart] = useState<Part>(params?.part === 'earth' ? 'earth' : 'dart');
  const [dart, setDart] = useState<DartInputs>(DART_REAL);
  const [earth, setEarth] = useState<EarthInputs>(EARTH_DEFAULT);
  const dr = useDart(dart);
  const er = useMemo(() => earthScenario(earth, 2000), [earth]);
  const er1 = useMemo(() => earthScenario({ ...earth, warningYears: 1 }, 1000, 0), [earth]);
  const er10 = useMemo(() => earthScenario({ ...earth, warningYears: 10 }, 1000, 0), [earth]);

  const replayParams = useMemo(() => ({
    periodBeforeS: dr.periodBeforeS,
    separationM: DART_CALIBRATION.separationM,
    periodAfterS: dr.periodAfterS,
    semiMajorAxisAfterM: dr.semiMajorAxisAfterM,
    eccentricityAfter: dr.eccentricityAfter,
    impactSpeedMS: dart.impactSpeedMS,
    ejectaScale: ((dart.beta - 1) * dart.impactorMassKg * dart.impactSpeedMS) /
      ((DART_REAL.beta - 1) * DART_REAL.impactorMassKg * DART_REAL.impactSpeedMS),
  }), [dr, dart]);

  const modDart = dartModified(dart);
  const modified = part === 'dart' ? modDart : true;
  const reset = (): void => {
    setDart(DART_REAL);
    setEarth(EARTH_DEFAULT);
  };
  const setD = <K extends keyof DartInputs>(k: K) => (v: number) => setDart(s => ({ ...s, [k]: v }));
  const setE = <K extends keyof EarthInputs>(k: K) => (v: number) => setEarth(s => ({ ...s, [k]: v }));

  const switcher = (
    <SegmentedControl<Part>
      label="Experiment"
      value={part}
      onChange={setPart}
      options={[{ value: 'dart', label: 'DART replay' }, { value: 'earth', label: 'Defend Earth' }]}
      className="cx-dfn-switch"
    />
  );

  if (part === 'dart') {
    const measured = DART_CALIBRATION.measuredDeltaPeriodS;
    const realAfterS = DART_CALIBRATION.periodBeforeS + measured;
    // Headline: first-order perturbation ΔP ≈ 3PΔv_T/v (lands inside the published 3σ interval); vis-viva shown in Explanation.
    const dp = dr.deltaPeriodLinearS;
    const modelAfterS = dr.periodBeforeS + dp;
    const result: LabResult = {
      caption: modDart ? 'Change in Dimorphos\'s orbital period in your scenario' : 'Change in Dimorphos\'s orbital period, modelled from the impact',
      value: fixed(dp / 60, 1),
      numeric: dp / 60,
      decimals: 1,
      unit: 'min',
    };
    const band = dr.bandLinear;
    const compare: LabCompareRow[] = [
      { label: 'Period change', real: `${minutes(measured)} ± 1.0`, modified: minutes(dp), difference: diff(dp, measured, minutes) },
      { label: 'New period', real: `${fixed(realAfterS / 3600, 3)} h`, modified: `${fixed(modelAfterS / 3600, 3)} h`, difference: diff(modelAfterS, realAfterS, minutes) },
      { label: 'Along-track push', real: `${speed(DART_CALIBRATION.alongTrackDeltaVMS)}`, modified: speed(dr.alongTrackDeltaVMS), difference: diff(dr.alongTrackDeltaVMS, DART_CALIBRATION.alongTrackDeltaVMS, speed) },
    ];
    return (
      <LabShell
        title="Asteroid deflection lab"
        subject="Didymos and Dimorphos"
        className="cx-dfn-shell cx-dfn-shell--replay"
        modified={modified}
        onReset={reset}
        onClose={onClose}
        realState={
          <>
            {switcher}
            <p className="cx-dfn-lede">
              On 26 September 2022 NASA's DART spacecraft hit Dimorphos, the 170 m moon of asteroid Didymos, head-on. It was the first
              test of moving an asteroid. Telescopes then timed Dimorphos's orbit: it had become 33 minutes shorter.
            </p>
            <div className="cx-facts">
              <Fact label="Impact" value={<span className="cx-id">{DART_IMPACT_UTC.replace('T', ' ').replace('Z', ' UTC')}</span>} kind="observed" source={SRC.daly} />
              <Fact label="Spacecraft mass" value={mass(DART_CALIBRATION.impactorMassKg)} kind="observed" source={SRC.cheng} />
              <Fact label="Impact speed" value={speed(DART_CALIBRATION.impactSpeedMS)} kind="observed" source={SRC.cheng} />
              <Fact label="Dimorphos mass" value={`${sci(DART_CALIBRATION.dimorphosMassKg)} kg`} kind="derived" source={`Shape volume (Daly et al. 2023) × ${DIMORPHOS_DENSITY_KGM3} kg/m³ assumed by Cheng et al. 2023`} />
              <Fact label="Orbit before" value={`${fixed(DART_CALIBRATION.periodBeforeS / 3600, 3)} h at ${fixed(DART_CALIBRATION.separationM / 1000, 3)} km`} kind="observed" source={SRC.thomas} />
              <Fact label="Measured period change" value={`${minutes(measured)} ± 1.0 (3σ)`} kind="observed" source={SRC.thomas} />
              <Fact label="Momentum factor β" value={`${fixed(DART_CALIBRATION.beta, 2)} (+0.19 / −0.25)`} kind="derived" source={SRC.cheng} />
              <Fact label="Along-track push Δv" value={`${speed(DART_CALIBRATION.alongTrackDeltaVMS)} ± 0.10`} kind="derived" source={SRC.cheng} />
            </div>
          </>
        }
        variables={
          <>
            <Slider label="Momentum factor β" value={dart.beta} onChange={setD('beta')} min={1} max={6} step={0.01}
              format={v => fixed(v, 2)} referenceValue={DART_REAL.beta} referenceLabel="Measured" />
            <Slider label="Spacecraft mass" value={dart.impactorMassKg} onChange={setD('impactorMassKg')} min={100} max={10000} scale="log"
              format={v => sig(v, 3)} unit="kg" referenceValue={DART_REAL.impactorMassKg} referenceLabel="DART" />
            <Slider label="Impact speed" value={dart.impactSpeedMS / 1000} onChange={v => setD('impactSpeedMS')(v * 1000)} min={1} max={15} step={0.05}
              format={v => fixed(v, 2)} unit="km/s" referenceValue={DART_REAL.impactSpeedMS / 1000} referenceLabel="DART" />
            <Slider label="Dimorphos density" value={dart.densityKgM3} onChange={setD('densityKgM3')} min={1000} max={3500} step={50}
              format={v => fixed(v, 0)} unit="kg/m³" referenceValue={DART_REAL.densityKgM3} referenceLabel="Assumed" />
          </>
        }
        visualization={<DartReplay params={replayParams} deltaPeriodS={dp} reduced={reduced} />}
        result={result}
        compare={compare}
        explanation={
          <div className="cx-dfn-explain">
            <p>
              The spacecraft carried {sci(dr.momentumKgMS)} kg m/s of momentum. Rock thrown out of the crater flew back towards space
              like rocket exhaust and added more push: β = {fixed(dart.beta, 2)} means the asteroid received {fixed(dart.beta, 2)} times
              the spacecraft's own momentum.
            </p>
            <Equation tex={String.raw`\Delta v = \beta\,\frac{m}{M}\,U = ${fixed(dr.deltaVMagnitudeMS * 1000, 2)}\ \mathrm{mm/s}`} display label="Delta v equals beta times m over M times U" />
            <p>
              About {fixed(DART_ALONG_TRACK_FACTOR * 100, 0)} % of that push acted against Dimorphos's orbital motion of
              {' '}{speed(dr.orbitalSpeedMS)}. Slowing a moon makes it drop into a smaller, faster orbit. For a small push the
              period change follows directly from the push:
            </p>
            <Equation tex={String.raw`\Delta P \approx 3P\,\frac{\Delta v_T}{v} = ${fixed(dp / 60, 1)}\ \mathrm{min}`} display label="Delta P is about 3 P times delta v T over v" />
            <p>
              Result: {minutes(dp)} per orbit
              {band && <> (90 % range {minutes(band.p95)} to {minutes(band.p05)} from the uncertainty in β)</>}. The measured change
              was {minutes(measured)} ± 1.0 (3σ). Solving the full point-mass orbit instead (vis-viva) gives {minutes(dr.deltaPeriodS)};
              the gap shows what treating both bodies as points leaves out (Didymos is a squashed spinning top, and the impact also
              reshaped Dimorphos).
            </p>
            <p className="cx-dfn-note">
              Models <span className="cx-id">{MODELS_USED.kinetic}</span>, <span className="cx-id">{MODELS_USED.binary}</span>.
            </p>
          </div>
        }
        assumptions={
          <ModelNotes
            ids={['kinetic-impact-beta', 'binary-period-change']}
            extra={[
              `Along-track fraction ${fixed(DART_ALONG_TRACK_FACTOR, 3)}: set so that the published mass, speed and β give the published Δv_T = −2.70 mm/s (${SRC.cheng}).`,
              `β uncertainty for the band: normal, σ = ${DART_BETA_SIGMA} (mean of the published +0.19 / −0.25); 2000 seeded trials.`,
              'Dimorphos mass scales with the chosen density at the shape-model volume; β itself was inferred assuming 2400 kg/m³.',
              'Replay: approach direction, Sun direction and ejecta-plume shape are reconstructed for illustration.',
            ]}
          />
        }
      />
    );
  }

  // ── Part 2: defend Earth ──
  const p = er.successProbability;
  const outcome = outcomeOf(p);
  const result: LabResult = {
    caption: 'Chance the deflected asteroid misses Earth',
    value: percent(p),
    numeric: Number.isFinite(p) ? p * 100 : undefined,
    decimals: 0,
    unit: '%',
  };
  return (
    <LabShell
      title="Asteroid deflection lab"
      subject="Defend Earth"
      modified={modified}
      className="cx-dfn-shell cx-dfn-shell--hypo"
      onReset={reset}
      onClose={onClose}
      realState={
        <>
          {switcher}
          <p className="cx-dfn-lede cx-dfn-hypo">
            A hypothetical asteroid is on course to hit Earth. You launch a kinetic impactor like DART. Does the push make it miss?
            Earth's numbers are real; the asteroid is invented.
          </p>
          <div className="cx-facts">
            <Fact label="Earth's radius" value={dist(EARTH_RADIUS_M)} kind="observed" source="IUGG mean radius" />
            <Fact label="Escape speed" value={speed(EARTH_ESCAPE_MS)} kind="derived" source="From GM and the mean radius" />
            <Fact label="Capture radius" value={dist(er.captureRadiusM)} kind="derived" source={`Gravitational focusing at v∞ = ${speed(earth.vInfinityMS)} (${MODELS_USED.focusing})`} />
            <Fact label="Reference spacecraft" value={`DART, ${mass(DART_CALIBRATION.impactorMassKg)}`} kind="observed" source={SRC.cheng} />
          </div>
        </>
      }
      variables={
        <>
          <Slider label="Asteroid diameter" value={earth.diameterM} onChange={setE('diameterM')} min={20} max={2000} scale="log"
            format={v => sig(v, 3)} unit="m" referenceValue={160} referenceLabel="Dimorphos" />
          <Slider label="Asteroid density" value={earth.densityKgM3} onChange={setE('densityKgM3')} min={1000} max={5000} step={50}
            format={v => fixed(v, 0)} unit="kg/m³" referenceValue={2400} referenceLabel="Dimorphos" />
          <Slider label="Warning time" value={earth.warningYears} onChange={setE('warningYears')} min={0.1} max={30} scale="log"
            format={v => (v < 1 ? fixed(v * 12, 0) : sig(v, 2))} unit={earth.warningYears < 1 ? 'months' : 'years'}
            marks={[{ value: 1, label: '1 yr' }, { value: 10, label: '10 yr' }]} />
          <Slider label="Spacecraft mass" value={earth.impactorMassKg} onChange={setE('impactorMassKg')} min={100} max={20000} scale="log"
            format={v => sig(v, 3)} unit="kg" referenceValue={DART_REAL.impactorMassKg} referenceLabel="DART" />
          <Slider label="Impact speed" value={earth.impactSpeedMS / 1000} onChange={v => setE('impactSpeedMS')(v * 1000)} min={1} max={20} step={0.1}
            format={v => fixed(v, 1)} unit="km/s" referenceValue={DART_REAL.impactSpeedMS / 1000} referenceLabel="DART" />
          <Slider label="Momentum factor β" value={earth.beta} onChange={setE('beta')} min={1} max={6} step={0.05}
            format={v => fixed(v, 2)} referenceValue={DART_REAL.beta} referenceLabel="DART" />
          <Slider label="Approach speed v∞" value={earth.vInfinityMS / 1000} onChange={v => setE('vInfinityMS')(v * 1000)} min={3} max={30} step={0.5}
            format={v => fixed(v, 1)} unit="km/s" />
        </>
      }
      visualization={
        <div className="cx-dfn-earthviz">
          <p className={`cx-dfn-outcome is-${outcome}`} role="status">{outcomeText(outcome, earth, er)}</p>
          <div className="cx-dfn-figs">
            <BPlane result={er} />
            <WarningChart inputs={earth} result={er} />
          </div>
        </div>
      }
      result={result}
      explanation={
        <div className="cx-dfn-explain">
          <p className={`cx-dfn-outcome-inline is-${outcome}`}>{outcomeText(outcome, earth, er)}</p>
          <p>
            The asteroid weighs {mass(er.asteroidMassKg)}. The spacecraft changes its speed by {speed(er.deltaVMS)}. That is tiny, but the
            asteroid then runs slightly ahead of or behind its old schedule, and the gap keeps growing: after {years(earth.warningYears)} it
            arrives {dist(er.missM)} away from where Earth will be.
          </p>
          <Equation tex={String.raw`\Delta s \approx 3\,\Delta v\,t, \qquad b = R_\oplus\sqrt{1 + v_\mathrm{esc}^2 / v_\infty^2}`} display label="Drift is about three times delta v times time; capture radius" />
          <p>
            Earth's gravity bends passing objects towards it, so it is a bigger target than its size: anything crossing within
            {' '}{dist(er.captureRadiusM)} hits. To clear that with {years(earth.warningYears)} of warning you need about
            {' '}{speed(er.requiredDeltaVMS)} (rule of thumb b / 3t: {speed(er.requiredDeltaVLinearMS)}).
          </p>
          <h4 className="cx-dfn-model__title">Compare: 1 year and 10 years of warning</h4>
          <table className="cx-lab-compare cx-dfn-compare">
            <thead>
              <tr><th scope="col"><span className="cx-sr-only">Quantity</span></th><th scope="col">1 year</th><th scope="col">10 years</th><th scope="col">Your setting</th></tr>
            </thead>
            <tbody>
              <tr><th scope="row">Median miss</th><td className="cx-num">{dist(er1.missBand.p50)}</td><td className="cx-num">{dist(er10.missBand.p50)}</td><td className="cx-num">{dist(er.missBand.p50)}</td></tr>
              <tr><th scope="row">Chance of a miss</th><td className="cx-num">{percent(er1.successProbability)} %</td><td className="cx-num">{percent(er10.successProbability)} %</td><td className="cx-num">{percent(p)} %</td></tr>
              <tr><th scope="row">Push needed</th><td className="cx-num">{speed(er1.requiredDeltaVMS)}</td><td className="cx-num">{speed(er10.requiredDeltaVMS)}</td><td className="cx-num">{speed(er.requiredDeltaVMS)}</td></tr>
            </tbody>
          </table>
          <p>
            If it hit, the impact would release about {sci(er.impactEnergyMt)} megatons of TNT equivalent at {speed(er.impactSurfaceSpeedMS)}.
          </p>
          <p className="cx-dfn-note">
            Models <span className="cx-id">{MODELS_USED.kinetic}</span>, <span className="cx-id">{MODELS_USED.drift}</span>,
            {' '}<span className="cx-id">{MODELS_USED.focusing}</span>; 2000 seeded Monte Carlo trials.
          </p>
        </div>
      }
      assumptions={
        <ModelNotes
          ids={['kinetic-impact-beta', 'deflection-drift', 'gravitational-focusing']}
          extra={[
            'The asteroid is hypothetical, on a near-circular Earth-like orbit, aimed at Earth\'s centre before deflection.',
            'The drift (Clohessy–Wiltshire) is taken to appear fully in the B-plane: an upper bound; real encounter geometry reduces it.',
            `Uncertainties per trial: β normal σ ${EARTH_UNCERTAINTY.betaSigma}; diameter ±${EARTH_UNCERTAINTY.diameterRel * 100} %; density ±${EARTH_UNCERTAINTY.densityRel * 100} %; spacecraft mass ±${EARTH_UNCERTAINTY.impactorMassRel * 100} %; speed ±${EARTH_UNCERTAINTY.impactSpeedRel * 100} %; along-track fraction ${EARTH_UNCERTAINTY.alongTrackMin}–${EARTH_UNCERTAINTY.alongTrackMax} (all assumed).`,
            'A miss is counted when the crossing point leaves the capture radius; no margin, no keyhole analysis, no fragmentation.',
          ]}
        />
      }
    />
  );
}

function outcomeText(o: ReturnType<typeof outcomeOf>, inp: EarthInputs, r: EarthResult): string {
  const pc = percent(r.successProbability);
  const ratio = r.requiredDeltaVMS / r.deltaVMS;
  // Push multiplier that would make 95 % of trials miss (scales every trial's miss distance).
  const for95 = r.captureRadiusM / r.missBand.p05;
  switch (o) {
    case 'deflected':
      return `Deflected. In ${pc} % of simulated cases the asteroid passes Earth, typically ${dist(r.missBand.p50 - r.captureRadiusM)} outside the capture radius.`;
    case 'likely':
      return for95 > 1
        ? `Probably safe: ${pc} % of cases miss. About ${fixed(for95, 1)}× the push, or more warning, would raise that to 95 %.`
        : `Probably safe: ${pc} % of cases miss. A second spacecraft or more warning would close the remaining gap.`;
    case 'uncertain':
      return `Too close to call: only ${pc} % of cases miss, because β and the asteroid's mass are uncertain. About ${fixed(for95, 1)}× the push would make 95 % of cases miss.`;
    default:
      return Number.isFinite(ratio)
        ? `Not enough. With ${years(inp.warningYears)} of warning the asteroid still hits: it needs about ${fixed(ratio, 1)}× this push, or about ${years(r.requiredWarningYears)} of warning.`
        : 'Not enough: the push is too small to compute a miss.';
  }
}
