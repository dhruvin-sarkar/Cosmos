import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { useCommands, useCosmos } from '../hooks';
import { Button } from '../components/Button';
import { EmptyState } from '../components/Misc';
import { LabShell } from './LabShell';
import { DEFAULT_LAB_TITLES, useLabPanel } from './registry';

class LabBoundary extends Component<{ onClose(): void; children: ReactNode }, { error: string | null }> {
  override state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown): { error: string } {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  override componentDidCatch(e: unknown, info: ErrorInfo): void {
    console.error('Lab panel crashed', e, info.componentStack);
  }
  override render(): ReactNode {
    if (this.state.error) {
      return (
        <section className="cx-lab" aria-label="Lab error">
          <EmptyState title="This lab stopped working" action={<Button onClick={this.props.onClose}>Close the lab</Button>}>
            {this.state.error}. The rest of Cosmos keeps running.
          </EmptyState>
        </section>
      );
    }
    return this.props.children;
  }
}

/** Hosts the active lab (store.lab.active) in the left column, replacing the inspector while open. */
export function LabDrawer() {
  const active = useCosmos(s => s.lab.active);
  const params = useCosmos(s => s.lab.params);
  const commands = useCommands();
  const entry = useLabPanel(active);
  if (!active) return null;
  const close = (): void => commands.closeLab();
  if (!entry) {
    return (
      <LabShell
        title={DEFAULT_LAB_TITLES[active]}
        modified={false}
        onReset={() => undefined}
        onClose={close}
        realState={
          <EmptyState title="This lab's module hasn't loaded">
            The lab is still being prepared. Close it and keep exploring; it will appear here when ready.
          </EmptyState>
        }
      />
    );
  }
  const Panel = entry.Component;
  return (
    <LabBoundary key={active} onClose={close}>
      {/* Lab panels are code-split (React.lazy in src/labs/<id>/index.ts): the shell shows while the chunk loads. */}
      <Suspense fallback={<LabShell title={entry.meta.title} modified={false} onReset={() => undefined} onClose={close} />}>
        <Panel labId={active} params={params} onClose={close} />
      </Suspense>
    </LabBoundary>
  );
}
