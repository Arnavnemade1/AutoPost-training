import type { ExperimentView, LedgerEntryView } from "./campaign.js";

/** HTML/SVG text escaping; every value from a file passes through it. */
export function esc(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** JSON for a `<script type="application/json">` block: raw text, so only `<` is neutralized. */
export function jsonScript(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

/** Categorical slot for an experiment: follows the entity (label order), never its rank. */
export function seriesSlot(experiments: ExperimentView[], label: string): number {
  const ordered = experiments.map((e) => e.label);
  return Math.min(ordered.indexOf(label), 7) + 1;
}

/**
 * Share of rollouts the worlds rewarded, per update, one 2px line per experiment. A
 * crosshair readout lists every series at the hovered update; a table view carries every
 * value, so the tooltip never gates one.
 */
export function rewardChart(experiments: ExperimentView[], plotHeight = 260): string {
  const series = experiments.filter((e) => e.updates.length);
  if (!series.length) return `<p class="empty">No GRPO updates recorded yet.</p>`;
  const width = 720,
    height = plotHeight,
    left = 44,
    right = 120,
    top = 16,
    bottom = 34;
  const maxUpdate = Math.max(
    ...series.map((e) => Math.max(e.maxUpdates ?? 0, e.updates.at(-1)!.update)),
  );
  const x = (update: number) =>
    left + ((update - 1) / Math.max(1, maxUpdate - 1)) * (width - left - right);
  const y = (share: number) => top + (1 - share) * (height - top - bottom);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const grid = ticks
    .map(
      (t) =>
        `<line class="grid" x1="${left}" x2="${width - right}" y1="${y(t)}" y2="${y(t)}"/>` +
        `<text class="tick" x="${left - 8}" y="${y(t) + 4}" text-anchor="end">${t * 100}%</text>`,
    )
    .join("");
  const xTicks = Array.from(new Set([1, Math.ceil(maxUpdate / 2), maxUpdate]))
    .map(
      (u) =>
        `<text class="tick" x="${x(u)}" y="${height - bottom + 18}" text-anchor="middle">${u}</text>`,
    )
    .join("");
  const share = (p: { rewardSum: number; rollouts: number }) =>
    p.rollouts ? p.rewardSum / p.rollouts : 0;
  const ends: { label: string; y: number }[] = [];
  const lines = series
    .map((e) => {
      const slot = seriesSlot(experiments, e.label);
      const points = e.updates
        .map((p) => `${x(p.update).toFixed(1)},${y(share(p)).toFixed(1)}`)
        .join(" ");
      const last = e.updates.at(-1)!;
      // A series that stopped early is named by the legend, not by a label far from its end.
      if (last.update === maxUpdate) ends.push({ label: e.label, y: y(share(last)) });
      return (
        `<polyline class="series s${slot}" points="${points}"/>` +
        `<circle class="end s${slot}" cx="${x(last.update)}" cy="${y(share(last))}" r="4"/>`
      );
    })
    .join("");
  // End labels only where they separate; converging lines rely on the legend and readout.
  ends.sort((a, b) => a.y - b.y);
  const labels = ends
    .filter(
      (end, i) =>
        (i === 0 || end.y - ends[i - 1].y >= 14) &&
        (i === ends.length - 1 || ends[i + 1].y - end.y >= 14),
    )
    .map(
      (end) =>
        `<text class="end-label" x="${width - right + 10}" y="${end.y + 4}">${esc(end.label)}</text>`,
    )
    .join("");
  const data = series.map((e) => ({
    label: e.label,
    slot: seriesSlot(experiments, e.label),
    points: e.updates.map((p) => [p.update, p.rewardSum, p.rollouts]),
  }));
  const legend = series
    .map(
      (e) =>
        `<li><svg aria-hidden="true" width="16" height="8"><line class="series s${seriesSlot(experiments, e.label)}" x1="0" x2="16" y1="4" y2="4"/></svg>${esc(e.label)}</li>`,
    )
    .join("");
  const rows = Array.from({ length: maxUpdate }, (_, i) => i + 1)
    .filter((u) => series.some((e) => e.updates.some((p) => p.update === u)))
    .map(
      (u) =>
        `<tr><th scope="row">${u}</th>${series
          .map((e) => {
            const p = e.updates.find((q) => q.update === u);
            return `<td>${p ? `${p.rewardSum}/${p.rollouts}` : "—"}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  return `<figure class="chart" data-chart="reward">
  <figcaption>Share of rollouts rewarded by the worlds, per update</figcaption>
  <ul class="legend">${legend}</ul>
  <div class="plot" tabindex="0" aria-describedby="reward-table-note">
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Line chart: share of rollouts rewarded per update for ${series.length} experiment${series.length > 1 ? "s" : ""}; values are in the table view below">
      ${grid}
      <line class="axis" x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}"/>
      ${xTicks}
      <text class="tick" x="${(left + width - right) / 2}" y="${height - 2}" text-anchor="middle">Update</text>
      ${lines}${labels}
      <line class="crosshair" x1="0" x2="0" y1="${top}" y2="${y(0)}" visibility="hidden"/>
    </svg>
    <div class="readout" role="status" aria-live="polite" hidden></div>
    <script type="application/json" class="chart-data">${jsonScript({ left, right, width, maxUpdate, data })}</script>
  </div>
  <details><summary id="reward-table-note">Table view</summary>
    <div tabindex="0" role="region" aria-label="Rewarded rollouts per update table" class="scroll"><table><caption>Rewarded rollouts per update</caption>
    <thead><tr><th scope="col">Update</th>${series.map((e) => `<th scope="col">${esc(e.label)}</th>`).join("")}</tr></thead>
    <tbody>${rows}</tbody></table></div>
  </details>
</figure>`;
}

/** Spent and reserved against the campaign budget: one ramp, a lighter step for reserved. */
export function budgetMeter(
  maxMicroUsd: number,
  spentMicroUsd: number,
  reservedMicroUsd: number,
): string {
  const spent = Math.min(1, spentMicroUsd / maxMicroUsd),
    reserved = Math.min(1 - spent, reservedMicroUsd / maxMicroUsd);
  return `<div class="meter" role="meter" aria-valuemin="0" aria-valuemax="${maxMicroUsd}" aria-valuenow="${spentMicroUsd + reservedMicroUsd}" aria-label="Budget used">
    <span class="spent" style="width:${(spent * 100).toFixed(2)}%"></span><span class="reserved" style="width:${(reserved * 100).toFixed(2)}%"></span>
  </div>`;
}

const kinds = ["diagnosis", "hypothesis", "decision", "stop"];
/**
 * The research ledger as a graph: each entry in a column by depth from the diagnosis,
 * edges to its parents. Kinds are named in every node, so identity never rests on color.
 */
export function ledgerGraph(all: LedgerEntryView[], maxColumns = Infinity): string {
  if (!all.length) return `<p class="empty">No ledger entries yet.</p>`;
  const depth = new Map<string, number>();
  for (const entry of all)
    depth.set(entry.entryId, Math.max(0, ...entry.parents.map((p) => (depth.get(p) ?? -1) + 1)));
  // A single-screen view keeps the most recent columns; the full view shows everything.
  const deepest = Math.max(...depth.values());
  const first = Math.max(0, deepest - maxColumns + 1);
  const entries = all.filter((e) => depth.get(e.entryId)! >= first);
  for (const entry of entries) depth.set(entry.entryId, depth.get(entry.entryId)! - first);
  const columns = new Map<number, LedgerEntryView[]>();
  for (const entry of entries)
    columns.set(depth.get(entry.entryId)!, [
      ...(columns.get(depth.get(entry.entryId)!) ?? []),
      entry,
    ]);
  const nodeWidth = 168,
    nodeHeight = 44,
    gapX = 36,
    gapY = 14;
  const position = new Map<string, { x: number; y: number }>();
  const tallest = Math.max(...[...columns.values()].map((c) => c.length));
  for (const [column, members] of columns)
    members.forEach((entry, row) =>
      position.set(entry.entryId, {
        x: 8 + column * (nodeWidth + gapX),
        y: 8 + row * (nodeHeight + gapY) + ((tallest - members.length) * (nodeHeight + gapY)) / 2,
      }),
    );
  const width = 16 + columns.size * (nodeWidth + gapX) - gapX;
  const height = 16 + tallest * (nodeHeight + gapY) - gapY;
  const edges = entries
    .flatMap((entry) =>
      entry.parents
        .filter((p) => position.has(p))
        .map((p) => {
          const from = position.get(p)!,
            to = position.get(entry.entryId)!;
          const x1 = from.x + nodeWidth,
            y1 = from.y + nodeHeight / 2,
            x2 = to.x,
            y2 = to.y + nodeHeight / 2;
          return `<path class="edge" d="M${x1},${y1} C${x1 + gapX / 2},${y1} ${x2 - gapX / 2},${y2} ${x2},${y2}"/>`;
        }),
    )
    .join("");
  const nodes = entries
    .map((entry) => {
      const { x, y } = position.get(entry.entryId)!;
      const slot = Math.max(0, kinds.indexOf(entry.kind)) + 1;
      const name = entry.entryId.replace(/^hypothesis-/, "").replace(/^governance-veto-/, "veto ");
      return `<g class="node"><title>${esc(entry.summary)}</title>
        <rect x="${x}" y="${y}" width="${nodeWidth}" height="${nodeHeight}" rx="6"/>
        <rect class="kind s${slot}" x="${x}" y="${y}" width="4" height="${nodeHeight}" rx="2"/>
        <text class="node-kind" x="${x + 12}" y="${y + 17}">${esc(entry.kind)} · ${entry.sequence}</text>
        <text class="node-name" x="${x + 12}" y="${y + 34}">${esc(name.length > 22 ? `${name.slice(0, 21)}…` : name)}</text></g>`;
    })
    .join("");
  const note =
    entries.length < all.length
      ? `<p class="note">Latest ${entries.length} of ${all.length} ledger entries.</p>`
      : "";
  return `${note}<div tabindex="0" role="region" aria-label="Research ledger graph" class="scroll graph"><svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Research ledger graph with ${entries.length} entries; the ledger list has every entry">${edges}${nodes}</svg></div>`;
}
