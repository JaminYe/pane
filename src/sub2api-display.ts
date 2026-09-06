// This adapter consumes Snapshot metrics; protocol parsing stays in Rust.
const SUMMARY_LABELS = new Set([
  "Today requests", "Today tokens", "Today actual cost",
  "Total requests", "Total tokens", "Total actual cost",
]);
const QUOTA_ORDER = ["Total quota", "5h", "1d", "7d", "Daily", "Weekly", "Monthly"];

interface DisplayMetric {
  label: string;
  kind: string;
  used_percent: number | null;
}

interface MetricLayout {
  metricOrder: string[];
  onDemand: string[];
  hidden: string[];
  starred: string[];
}

// A fetch can finish after a successful settings mutation, including while the
// caller awaits a config write. Only affected Keys lose that fetch's authority.
export class Sub2ApiSnapshotContexts {
  private generations = new Map<string, number>();

  capture(): ReadonlyMap<string, number> {
    return new Map(this.generations);
  }

  invalidate(ids: string[]): void {
    for (const id of ids) this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
  }

  publish<S extends { id: string }>(incoming: S[], started: ReadonlyMap<string, number>, current: S[]): S[] {
    const changed = (id: string) => (started.get(id) ?? 0) !== (this.generations.get(id) ?? 0);
    const accepted = incoming.filter((snapshot) => !changed(snapshot.id));
    // Renames retain their current data; rotations/deletes have already removed
    // it. An old result must neither restore cleared data nor erase a rename.
    for (const snapshot of current) {
      if (changed(snapshot.id)) accepted.push(snapshot);
    }
    return accepted;
  }
}

export function sub2ApiStatusDetails(metrics: { label: string; value?: string | null }[]): string[] {
  return metrics.filter((metric) => metric.label === "Status" && metric.value)
    .map((metric) => metric.value!);
}

export function sub2ApiOnDemand(label: string): boolean {
  return SUMMARY_LABELS.has(label);
}

export function sub2ApiPrimaryMetric<M extends DisplayMetric>(metrics: M[]): M | undefined {
  let primary: M | undefined;
  for (const label of QUOTA_ORDER) {
    const metric = metrics.find((candidate) => candidate.label === label);
    const percent = metric?.used_percent;
    if (metric?.kind !== "progress" || percent === null || percent === undefined || !Number.isFinite(percent) || percent < 0) continue;
    if (!primary || percent > primary.used_percent!) primary = metric;
  }
  return primary ?? metrics.find((metric) => metric.label === "Balance")
    ?? metrics.find((metric) => metric.label === "Remaining amount");
}

export function reconcileSub2ApiLayout(metrics: DisplayMetric[], layout: MetricLayout): boolean {
  // Replace mode-specific rows instead of keeping old wallet/subscription rows
  // in Customize. Existing live row choices and the card identity remain stable.
  const live = new Set(metrics.map((metric) => metric.label));
  let changed = false;
  for (const field of ["metricOrder", "onDemand", "hidden", "starred"] as const) {
    const current = layout[field];
    const next = current.filter((label) => live.has(label));
    if (current.length !== next.length) {
      layout[field] = next;
      changed = true;
    }
  }
  for (const metric of metrics) {
    if (layout.metricOrder.includes(metric.label)) continue;
    if (sub2ApiOnDemand(metric.label)) {
      layout.metricOrder.push(metric.label);
      layout.onDemand.push(metric.label);
    } else {
      const summaryAt = layout.metricOrder.findIndex(sub2ApiOnDemand);
      layout.metricOrder.splice(summaryAt < 0 ? layout.metricOrder.length : summaryAt, 0, metric.label);
    }
    changed = true;
  }
  return changed;
}
