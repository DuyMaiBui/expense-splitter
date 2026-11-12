import type {
  Balance,
  DirectDebt,
  ExpenseKind,
  PairEvent,
  PairRemovedRevision,
  PairRevision,
  PairRow,
  PairStatement,
  Transfer,
} from "./types";

/**
 * Pair-level settlement: who actually spent for whom, and the payments that settle it. Pure
 * functions, import-safe on the server and in client components (type-only imports), so the
 * arithmetic is unit-testable without a database. Contract: docs/CONTRACT.md (settlement, pairs).
 *
 * Direction convention: a row whose payer is X and whose share holder is Y (Y != X) means
 * "Y owes X". A payment row is an ordinary row, so it needs no special case here.
 */

/** Code-unit comparison: deterministic on every runtime, unlike locale collation. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Null-safe lookup into an id-keyed map, failing loudly rather than inventing a value. */
function requireMap<V>(map: Map<string, V>, id: string, what: string): V {
  const value = map.get(id);
  if (value === undefined) throw new Error(`pairs: unknown ${what} "${id}"`);
  return value;
}

/**
 * Nets the reverse direction per ordered pair: `debtorId` owes `creditorId` (rows paid by the
 * creditor with the debtor's share) minus what `creditorId` owes `debtorId`. Only positive results
 * are returned, sorted by debtorId then creditorId. Input rows may repeat a pair; they are summed.
 */
export function directDebts(rows: readonly PairRow[]): DirectDebt[] {
  const owes = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.debtorId === row.payerId) {
      throw new Error(`pairs: a row cannot make ${row.debtorId} owe their own payer`);
    }
    if (!Number.isSafeInteger(row.amount) || row.amount < 0) {
      throw new Error(`pairs: amount must be a non-negative integer VND, got ${row.amount}`);
    }
    if (row.amount === 0) continue;
    const byCreditor = owes.get(row.debtorId) ?? new Map<string, number>();
    byCreditor.set(row.payerId, (byCreditor.get(row.payerId) ?? 0) + row.amount);
    owes.set(row.debtorId, byCreditor);
  }

  const debts: DirectDebt[] = [];
  for (const [debtorId, byCreditor] of owes) {
    for (const [creditorId, amount] of byCreditor) {
      const reverse = owes.get(creditorId)?.get(debtorId) ?? 0;
      const net = amount - reverse;
      if (net > 0) debts.push({ debtorId, creditorId, amount: net });
    }
  }
  return debts.sort(
    (a, b) => compareText(a.debtorId, b.debtorId) || compareText(a.creditorId, b.creditorId),
  );
}

/* ----------------------------------------------------------------------------- planTransfers */

/** A residual-graph arc. `orig` is the capacity it was created with (0 on reverse arcs). */
interface Arc {
  to: number;
  cap: number;
  rev: number;
  orig: number;
}

function addArc(graph: Arc[][], from: number, to: number, cap: number): Arc {
  graph[from]!.push({ to, cap, rev: graph[to]!.length, orig: cap });
  graph[to]!.push({ to: from, cap: 0, rev: graph[from]!.length - 1, orig: 0 });
  return graph[from]![graph[from]!.length - 1]!;
}

/**
 * Edmonds-Karp on the residual graph. Arcs are scanned in insertion order, so the same input always
 * augments along the same paths and yields the same flow.
 */
function maxFlow(graph: Arc[][], source: number, sink: number): void {
  for (;;) {
    const prevNode = new Array<number>(graph.length).fill(-1);
    const prevArc = new Array<number>(graph.length).fill(-1);
    prevNode[source] = source;
    const queue = [source];
    for (let head = 0; head < queue.length && prevNode[sink] === -1; head++) {
      const u = queue[head]!;
      graph[u]!.forEach((arc, index) => {
        if (arc.cap > 0 && prevNode[arc.to] === -1) {
          prevNode[arc.to] = u;
          prevArc[arc.to] = index;
          queue.push(arc.to);
        }
      });
    }
    if (prevNode[sink] === -1) return;

    let bottleneck = Infinity;
    for (let v = sink; v !== source; v = prevNode[v]!) {
      bottleneck = Math.min(bottleneck, graph[prevNode[v]!]![prevArc[v]!]!.cap);
    }
    for (let v = sink; v !== source; v = prevNode[v]!) {
      const arc = graph[prevNode[v]!]![prevArc[v]!]!;
      arc.cap -= bottleneck;
      graph[v]![arc.rev]!.cap += bottleneck;
    }
  }
}

/* -------------------------------------------------------------------------- planTransfers */

/** Above this many debtors or creditors the lexicographic search is skipped (see docs/CONTRACT.md). */
const LEXICOGRAPHIC_LIMIT = 14;

const SOURCE = 0;
const SINK = 1;

/** The flow problem: debtors (net < 0) and creditors (net > 0), each sorted by member id. */
interface Problem {
  debtorIds: string[];
  creditorIds: string[];
  /** Each debtor's net deficit (positive). */
  deficit: number[];
  /** Each creditor's net surplus (positive). */
  surplus: number[];
  /** `debt[i][j]`: the direct debt debtor i owes creditor j (0 when none). */
  debt: number[][];
  /** Each debtor's slack: its direct debts to anyone, minus its deficit. */
  slack: number[];
}

function zeros(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
}

function buildProblem(balances: readonly Balance[], debts: readonly DirectDebt[]): Problem {
  const netOf = new Map<string, number>(balances.map((b): [string, number] => [b.memberId, b.net]));
  const debtorIds = balances.filter((b) => b.net < 0).map((b) => b.memberId).sort(compareText);
  const creditorIds = balances.filter((b) => b.net > 0).map((b) => b.memberId).sort(compareText);
  const debtorIndex = new Map<string, number>(debtorIds.map((id, i): [string, number] => [id, i]));
  const creditorIndex = new Map<string, number>(creditorIds.map((id, j): [string, number] => [id, j]));

  const debt = zeros(debtorIds.length, creditorIds.length);
  const owedBy = new Map<string, number>();
  for (const d of debts) {
    if (!Number.isSafeInteger(d.amount) || d.amount <= 0) {
      throw new Error(`pairs: a direct debt must be a positive integer VND, got ${d.amount}`);
    }
    if (d.debtorId === d.creditorId) throw new Error("pairs: a direct debt cannot be to oneself");
    owedBy.set(d.debtorId, (owedBy.get(d.debtorId) ?? 0) + d.amount);
    const i = debtorIndex.get(d.debtorId);
    const j = creditorIndex.get(d.creditorId);
    if (i !== undefined && j !== undefined) debt[i][j] += d.amount;
  }

  const deficit = debtorIds.map((id) => -netOf.get(id)!);
  return {
    debtorIds,
    creditorIds,
    deficit,
    surplus: creditorIds.map((id) => netOf.get(id)!),
    debt,
    slack: debtorIds.map((id, i) => (owedBy.get(id) ?? 0) - deficit[i]!),
  };
}

/** Plain max flow with no bounds: the maximum direct total, and the fallback for large groups. */
function edmondsKarpFlows(p: Problem): number[][] {
  const nD = p.debtorIds.length;
  const nC = p.creditorIds.length;
  const graph: Arc[][] = Array.from({ length: 2 + nD + nC }, () => []);
  p.deficit.forEach((d, i) => addArc(graph, SOURCE, 2 + i, d));
  p.surplus.forEach((s, j) => addArc(graph, 2 + nD + j, SINK, s));
  const cells: Array<{ i: number; j: number; arc: Arc }> = [];
  for (let i = 0; i < nD; i++) {
    for (let j = 0; j < nC; j++) {
      if (p.debt[i][j] > 0) cells.push({ i, j, arc: addArc(graph, 2 + i, 2 + nD + j, p.debt[i][j]) });
    }
  }
  maxFlow(graph, SOURCE, SINK);
  const flows = zeros(nD, nC);
  for (const cell of cells) flows[cell.i][cell.j] = cell.arc.orig - cell.arc.cap;
  return flows;
}

interface BoundedArc {
  from: number;
  to: number;
  lo: number;
  hi: number;
}

/**
 * A flow that respects every arc's lower and upper bound, by the standard reduction to one max flow
 * between a super source and a super sink. Returns each arc's flow, aligned with `arcs`, or null
 * when no flow meets every bound.
 */
function boundedFlow(nodeCount: number, arcs: readonly BoundedArc[]): number[] | null {
  const superSource = nodeCount;
  const superSink = nodeCount + 1;
  const graph: Arc[][] = Array.from({ length: nodeCount + 2 }, () => []);
  const excess = new Array<number>(nodeCount).fill(0);
  const handles: Arc[] = [];
  for (const arc of arcs) {
    if (arc.lo > arc.hi) return null;
    excess[arc.to] += arc.lo;
    excess[arc.from] -= arc.lo;
    handles.push(addArc(graph, arc.from, arc.to, arc.hi - arc.lo));
  }
  const supplies: Arc[] = [];
  excess.forEach((e, v) => {
    if (e > 0) supplies.push(addArc(graph, superSource, v, e));
    else if (e < 0) addArc(graph, v, superSink, -e);
  });
  maxFlow(graph, superSource, superSink);
  if (supplies.some((arc) => arc.cap > 0)) return null;
  return arcs.map((arc, k) => arc.lo + (handles[k].orig - handles[k].cap));
}

interface Bounds {
  /** Debtors settled in full: their whole deficit goes to direct creditors (no offset). */
  full: ReadonlySet<number>;
  /** When set, each debtor is left with at most this much unpaid (its offset is at most this). */
  debtorBound: number | null;
  /** When set, each creditor is left with at most this much unpaid. */
  creditorBound: number | null;
  /** The exact direct total: the maximum found by `edmondsKarpFlows`. */
  total: number;
}

/** A direct flow of exactly `bounds.total` that meets every bound, or null when none exists. */
function flowWithin(p: Problem, bounds: Bounds): number[][] | null {
  const nD = p.debtorIds.length;
  const nC = p.creditorIds.length;
  const arcs: BoundedArc[] = [];
  p.deficit.forEach((d, i) => {
    const lo = bounds.full.has(i) ? d : bounds.debtorBound === null ? 0 : Math.max(0, d - bounds.debtorBound);
    arcs.push({ from: SOURCE, to: 2 + i, lo, hi: d });
  });
  const cells: Array<{ i: number; j: number; at: number }> = [];
  for (let i = 0; i < nD; i++) {
    for (let j = 0; j < nC; j++) {
      if (p.debt[i][j] <= 0) continue;
      cells.push({ i, j, at: arcs.length });
      arcs.push({ from: 2 + i, to: 2 + nD + j, lo: 0, hi: p.debt[i][j] });
    }
  }
  p.surplus.forEach((s, j) => {
    const lo = bounds.creditorBound === null ? 0 : Math.max(0, s - bounds.creditorBound);
    arcs.push({ from: 2 + nD + j, to: SINK, lo, hi: s });
  });
  arcs.push({ from: SINK, to: SOURCE, lo: bounds.total, hi: bounds.total });

  const flows = boundedFlow(2 + nD + nC, arcs);
  if (flows === null) return null;
  const within = zeros(nD, nC);
  for (const cell of cells) within[cell.i][cell.j] = flows[cell.at];
  return within;
}

/** Every k-subset of 0..n-1, in lexicographic order of the index tuples. */
function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const pick: number[] = [];
  const walk = (start: number): void => {
    if (pick.length === k) {
      out.push([...pick]);
      return;
    }
    for (let i = start; i <= n - (k - pick.length); i++) {
      pick.push(i);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return out;
}

/** Smallest bound in [0, hi] for which `feasible` holds; `feasible(hi)` must hold. */
function smallestFeasible(hi: number, feasible: (bound: number) => boolean): number {
  let lo = 0;
  let top = hi;
  while (lo < top) {
    const mid = Math.floor((lo + top) / 2);
    if (feasible(mid)) top = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Slacks of the offset debtors (those outside `fullSet`), sorted descending. */
function offsetSlacks(p: Problem, fullSet: readonly number[]): number[] {
  const settled = new Set(fullSet);
  const slacks: number[] = [];
  p.slack.forEach((slack, i) => {
    if (!settled.has(i)) slacks.push(slack);
  });
  return slacks.sort((a, b) => b - a);
}

/** Lexicographic comparison of two descending vectors of equal length: positive when `a` is larger. */
function compareVectors(a: readonly number[], b: readonly number[]): number {
  for (let k = 0; k < Math.min(a.length, b.length); k++) {
    if (a[k] !== b[k]) return a[k]! - b[k]!;
  }
  return a.length - b.length;
}

/**
 * The lexicographic choice among max-total direct flows (owner's rule):
 *  (i)   fewest debtors with any offset: the largest set of debtors that can all be settled in full;
 *  (ii)  among those sets, the offsets go to the debtors with the largest slack. A debtor's slack is
 *        its direct debts to anyone minus its deficit. Sets are compared by their offset debtors'
 *        slacks sorted descending, the lexicographically larger vector winning. A debtor who owes
 *        exactly what it must pay has slack 0 and is paid cleanly whenever feasible;
 *  (iii) then the smallest largest offset: greedy offsets never grow, so that offset is
 *        min(largest leftover deficit, largest leftover surplus). Over the tied sets it is minimised by
 *        a binary search on the debtor-side or creditor-side bound;
 *  (iv)  fewer transfers: not optimised (the flow found meets (i) to (iii));
 *  (v)   determinism: sets are enumerated in member-id order and the first best one wins.
 */
function lexicographicFlows(p: Problem): number[][] {
  const nD = p.debtorIds.length;
  const total = edmondsKarpFlows(p).reduce((sum, row) => sum + row.reduce((a, b) => a + b, 0), 0);
  const maxDeficit = Math.max(0, ...p.deficit);
  const maxSurplus = Math.max(0, ...p.surplus);

  // (i) The largest set of debtors that can all be settled in full with the max total.
  let fullSets: number[][] = [];
  for (let k = nD; k >= 0 && fullSets.length === 0; k--) {
    fullSets = combinations(nD, k).filter(
      (set) => flowWithin(p, { full: new Set(set), debtorBound: null, creditorBound: null, total }) !== null,
    );
  }

  // (ii) Among those sets, the offsets go to the largest slacks: the lexicographically larger vector wins.
  let top: number[][] = [];
  let topVector: number[] | null = null;
  for (const set of fullSets) {
    const vector = offsetSlacks(p, set);
    const cmp = topVector === null ? 1 : compareVectors(vector, topVector);
    if (cmp > 0) {
      topVector = vector;
      top = [set];
    } else if (cmp === 0) {
      top.push(set);
    }
  }

  // (iii) For the tied sets, the smallest achievable largest offset, on whichever side is smaller.
  let best: { set: number[]; side: "debtor" | "creditor"; bound: number } | null = null;
  let bestValue = Infinity;
  for (const set of top) {
    const full = new Set(set);
    const debtorBound = smallestFeasible(
      maxDeficit,
      (bound) => flowWithin(p, { full, debtorBound: bound, creditorBound: null, total }) !== null,
    );
    const creditorBound = smallestFeasible(
      maxSurplus,
      (bound) => flowWithin(p, { full, debtorBound: null, creditorBound: bound, total }) !== null,
    );
    const side = debtorBound <= creditorBound ? "debtor" : "creditor";
    const value = Math.min(debtorBound, creditorBound);
    if (value < bestValue) {
      bestValue = value;
      best = { set, side, bound: value };
    }
  }
  if (best === null) throw new Error("pairs: no direct flow meets the lexicographic bounds");

  const chosen = flowWithin(p, {
    full: new Set(best.set),
    debtorBound: best.side === "debtor" ? best.bound : null,
    creditorBound: best.side === "creditor" ? best.bound : null,
    total,
  });
  if (chosen === null) throw new Error("pairs: the chosen lexicographic flow lost feasibility");
  return chosen;
}

/** Direct transfers from a flow matrix, then the greedy offsets over what is left. */
function assemble(p: Problem, flows: number[][]): Transfer[] {
  const transfers: Transfer[] = [];
  const leftDeficit = [...p.deficit];
  const leftSurplus = [...p.surplus];
  for (let i = 0; i < p.debtorIds.length; i++) {
    for (let j = 0; j < p.creditorIds.length; j++) {
      const amount = flows[i][j];
      if (amount <= 0) continue;
      transfers.push({
        fromMemberId: p.debtorIds[i],
        toMemberId: p.creditorIds[j],
        amount,
        basis: "direct",
        directDebt: p.debt[i][j],
      });
      leftDeficit[i] -= amount;
      leftSurplus[j] -= amount;
    }
  }

  // Step 2: largest-with-largest over the leftovers; member id breaks ties.
  const debtors = leftDeficit.map((remaining, i) => ({ i, remaining })).filter((x) => x.remaining > 0);
  const creditors = leftSurplus.map((remaining, j) => ({ j, remaining })).filter((x) => x.remaining > 0);
  debtors.sort(
    (a, b) => b.remaining - a.remaining || compareText(p.debtorIds[a.i]!, p.debtorIds[b.i]!),
  );
  creditors.sort(
    (a, b) => b.remaining - a.remaining || compareText(p.creditorIds[a.j]!, p.creditorIds[b.j]!),
  );

  let c = 0;
  let d = 0;
  while (c < creditors.length && d < debtors.length) {
    const creditor = creditors[c]!;
    const debtor = debtors[d]!;
    const amount = Math.min(creditor.remaining, debtor.remaining);
    if (amount > 0) {
      transfers.push({
        fromMemberId: p.debtorIds[debtor.i]!,
        toMemberId: p.creditorIds[creditor.j]!,
        amount,
        basis: "offset",
        directDebt: p.debt[debtor.i]![creditor.j]!,
      });
    }
    creditor.remaining -= amount;
    debtor.remaining -= amount;
    if (creditor.remaining === 0) c += 1;
    if (debtor.remaining === 0) d += 1;
  }
  return transfers;
}

/**
 * Chooses the settlement payments for a group. Step 1 takes a maximum direct flow (the true maximum
 * total), chosen by the lexicographic rule of `lexicographicFlows`; step 2 matches the leftovers with
 * the largest-with-largest greedy rule and labels them "offset". For more than LEXICOGRAPHIC_LIMIT
 * debtors or creditors the search is skipped and the plain max flow is used (docs/CONTRACT.md).
 *
 * `balances` must sum to 0 (it does when every share sums to its expense amount); any residue is
 * ignored rather than invented. Every output transfer goes from a net debtor to a net creditor.
 */
export function planTransfers(balances: readonly Balance[], debts: readonly DirectDebt[]): Transfer[] {
  const p = buildProblem(balances, debts);
  const searchable = p.debtorIds.length <= LEXICOGRAPHIC_LIMIT && p.creditorIds.length <= LEXICOGRAPHIC_LIMIT;
  return assemble(p, searchable ? lexicographicFlows(p) : edmondsKarpFlows(p));
}

/* -------------------------------------------------------------------------- buildPairStatements */

/**
 * One live row (expense or payment) between the statement's member M and a counterparty P. Only
 * rows where one of them paid and the other holds a share are passed in. Plain data, no D1 types.
 */
export interface PairEventRow {
  expenseId: string;
  kind: ExpenseKind;
  title: string;
  spentAt: string;
  createdAt: string;
  /** M or P: the one who paid the row. */
  paidByMemberId: string;
  /** The other party of this pair (never M). */
  counterpartyMemberId: string;
  /** M's `expense_shares.amount` on the row (0 if none). */
  memberShare: number;
  /** P's `expense_shares.amount` on the row (0 if none). */
  counterpartyShare: number;
}

/** An expense as it stood before or after one edit: who paid, the amount, and each share by member id. */
export interface PairRevisionSnapshot {
  paidByMemberId: string;
  amount: number;
  shares: Record<string, number>;
}

/**
 * One parsed activity_log update or delete of an expense. `before` is always present; `after` is
 * null for a delete. `title` is the expense's title as it stood before the change.
 */
export interface PairRevisionRow {
  expenseId: string;
  title: string;
  at: string;
  actorName: string;
  action: "update" | "delete";
  before: PairRevisionSnapshot;
  after: PairRevisionSnapshot | null;
}

/** The fields of an activity_log row that revision parsing reads. */
export interface ActivityLogRevisionInput {
  entityId: string;
  actorName: string;
  action: string;
  createdAt: string;
  detailJson: string | null;
}

/** Parses the Expense JSON carried by an activity_log detail into the fields a statement needs. */
function parseSnapshot(raw: unknown, label: string): PairRevisionSnapshot {
  if (typeof raw !== "object" || raw === null) throw new Error(`pairs: ${label} is not an expense`);
  const expense = raw as { paidByMemberId?: unknown; amount?: unknown; shares?: unknown };
  if (typeof expense.paidByMemberId !== "string") {
    throw new Error(`pairs: ${label}.paidByMemberId is not a string`);
  }
  if (typeof expense.amount !== "number") throw new Error(`pairs: ${label}.amount is not a number`);
  if (!Array.isArray(expense.shares)) throw new Error(`pairs: ${label}.shares is not an array`);
  const shares: Record<string, number> = {};
  for (const share of expense.shares as Array<{ memberId?: unknown; amount?: unknown }>) {
    if (typeof share.memberId !== "string" || typeof share.amount !== "number") {
      throw new Error(`pairs: ${label}.shares has a malformed entry`);
    }
    shares[share.memberId] = share.amount;
  }
  return { paidByMemberId: expense.paidByMemberId, amount: expense.amount, shares };
}

/**
 * Turns one activity_log row into a revision. Returns null for any action other than
 * `expense.update` / `expense.delete` (the caller filters, so this is never a silent drop of an
 * expense change). A matching row whose detail is missing or malformed throws: a corrupt audit row
 * is a data bug, not something to hide.
 */
export function parseRevision(log: ActivityLogRevisionInput): PairRevisionRow | null {
  if (log.action !== "expense.update" && log.action !== "expense.delete") return null;
  if (log.detailJson === null) throw new Error(`pairs: log entry for expense ${log.entityId} has no detail`);

  let detail: { before?: unknown; after?: unknown };
  try {
    detail = JSON.parse(log.detailJson) as { before?: unknown; after?: unknown };
  } catch {
    throw new Error(`pairs: log entry for expense ${log.entityId} has invalid detail JSON`);
  }

  const before = parseSnapshot(detail.before, "before");
  const title = (detail.before as { title?: unknown }).title;
  if (typeof title !== "string") throw new Error(`pairs: before.title of expense ${log.entityId} is not a string`);

  if (log.action === "expense.delete") {
    return { expenseId: log.entityId, title, at: log.createdAt, actorName: log.actorName, action: "delete", before, after: null };
  }
  return {
    expenseId: log.entityId,
    title,
    at: log.createdAt,
    actorName: log.actorName,
    action: "update",
    before,
    after: parseSnapshot(detail.after, "after"),
  };
}

/** Whether one snapshot is a row between `memberId` and `counterpartyId`: one paid, the other holds a share. */
function snapshotInvolves(snapshot: PairRevisionSnapshot | null, memberId: string, counterpartyId: string): boolean {
  if (snapshot === null) return false;
  const { paidByMemberId: payer, shares } = snapshot;
  return (
    (payer === memberId && shares[counterpartyId] !== undefined) ||
    (payer === counterpartyId && shares[memberId] !== undefined)
  );
}

/** Whether a revision touched a row between the pair, before or after the edit. */
function revisionInvolves(revision: PairRevisionRow, memberId: string, counterpartyId: string): boolean {
  return (
    snapshotInvolves(revision.before, memberId, counterpartyId) ||
    snapshotInvolves(revision.after, memberId, counterpartyId)
  );
}

/** Every counterparty a revision concerns for `memberId`: the other side of each row it touched. */
function revisionCounterparties(memberId: string, revision: PairRevisionRow): string[] {
  const found = new Set<string>();
  for (const snapshot of [revision.before, revision.after]) {
    if (snapshot === null) continue;
    if (snapshot.paidByMemberId === memberId) {
      for (const id of Object.keys(snapshot.shares)) if (id !== memberId) found.add(id);
    } else if (snapshot.shares[memberId] !== undefined) {
      found.add(snapshot.paidByMemberId);
    }
  }
  return [...found];
}

/** The amounts of one revision as seen from the pair (shared by attached and removed revisions). */
function revisionShares(revision: PairRevisionRow, memberId: string, counterpartyId: string) {
  return {
    beforeAmount: revision.before.amount,
    afterAmount: revision.after?.amount ?? null,
    beforeMemberShare: revision.before.shares[memberId] ?? 0,
    afterMemberShare: revision.after ? (revision.after.shares[memberId] ?? 0) : null,
    beforeCounterpartyShare: revision.before.shares[counterpartyId] ?? 0,
    afterCounterpartyShare: revision.after ? (revision.after.shares[counterpartyId] ?? 0) : null,
  };
}

/**
 * Builds one statement per counterparty that has live events OR a revision that touched a row between
 * the pair, sorted by |net| desc then name. `rows` are the member's live pair rows (see PairEventRow);
 * `revisions` are the parsed update/delete rows of the group's expenses (unrelated ones are ignored
 * here). `members` resolves names and removal flags for the member and every counterparty; an
 * unknown id throws.
 *
 * `delta` per event: +counterpartyShare when the member paid, -memberShare when the counterparty paid.
 * Events are ordered createdAt asc then expenseId asc, and runningNet accumulates in that order.
 * A revision of an expense that is a live event of the pair attaches to that event (`revisions`).
 * A revision that touched the pair but is not a live event of it (a deleted expense, or one edited
 * out of the pair) lands in `removedRevisions`, ordered by `at` asc.
 *
 * `afterLaterPayment` (both kinds): true when the revision `at` is later than the createdAt of any
 * payment event of this pair, i.e. money had already moved between the two before the change.
 */
export function buildPairStatements(
  memberId: string,
  rows: readonly PairEventRow[],
  revisions: readonly PairRevisionRow[],
  members: Record<string, { name: string; removed: boolean }>,
): PairStatement[] {
  const roster = new Map(Object.entries(members));
  const memberInfo = (id: string) => requireMap(roster, id, "member");

  const revisionsByExpense = new Map<string, PairRevisionRow[]>();
  for (const revision of revisions) {
    const list = revisionsByExpense.get(revision.expenseId) ?? [];
    list.push(revision);
    revisionsByExpense.set(revision.expenseId, list);
  }

  const byCounterparty = new Map<string, PairEventRow[]>();
  for (const row of rows) {
    if (row.counterpartyMemberId === memberId) throw new Error("pairs: a member has no pair with themself");
    if (row.paidByMemberId !== memberId && row.paidByMemberId !== row.counterpartyMemberId) {
      throw new Error(`pairs: row ${row.expenseId} is not between ${memberId} and ${row.counterpartyMemberId}`);
    }
    const list = byCounterparty.get(row.counterpartyMemberId) ?? [];
    list.push(row);
    byCounterparty.set(row.counterpartyMemberId, list);
  }
  // A counterparty whose only trace is a removed revision still gets a statement (no events, net 0).
  for (const revision of revisions) {
    for (const id of revisionCounterparties(memberId, revision)) {
      if (!byCounterparty.has(id)) byCounterparty.set(id, []);
    }
  }

  const byAt = (a: PairRevisionRow, b: PairRevisionRow) => compareText(a.at, b.at);
  const statements: PairStatement[] = [];
  for (const [counterpartyId, pairRows] of byCounterparty) {
    const counterparty = memberInfo(counterpartyId);
    const ordered = [...pairRows].sort(
      (a, b) => compareText(a.createdAt, b.createdAt) || compareText(a.expenseId, b.expenseId),
    );

    let runningNet = 0;
    const events: PairEvent[] = ordered.map((row) => {
      const delta = row.paidByMemberId === memberId ? row.counterpartyShare : -row.memberShare;
      runningNet += delta;
      return {
        expenseId: row.expenseId,
        kind: row.kind,
        title: row.title,
        spentAt: row.spentAt,
        createdAt: row.createdAt,
        paidByMemberId: row.paidByMemberId,
        paidByName: memberInfo(row.paidByMemberId).name,
        memberShare: row.memberShare,
        counterpartyShare: row.counterpartyShare,
        delta,
        runningNet,
        revisions: [],
      };
    });

    const paymentTimes = events.filter((e) => e.kind === "payment").map((e) => e.createdAt);
    const laterThanAPayment = (at: string) => paymentTimes.some((createdAt) => compareText(at, createdAt) > 0);

    const liveIds = new Set(events.map((e) => e.expenseId));
    for (const event of events) {
      const attached = [...(revisionsByExpense.get(event.expenseId) ?? [])].sort(byAt);
      event.revisions = attached.map((revision): PairRevision => ({
        at: revision.at,
        actorName: revision.actorName,
        action: revision.action,
        ...revisionShares(revision, memberId, counterpartyId),
        afterLaterPayment: laterThanAPayment(revision.at),
      }));
    }

    const removedRevisions: PairRemovedRevision[] = revisions
      .filter((r) => !liveIds.has(r.expenseId) && revisionInvolves(r, memberId, counterpartyId))
      .sort(byAt)
      .map((revision) => ({
        expenseId: revision.expenseId,
        title: revision.title,
        at: revision.at,
        actorName: revision.actorName,
        action: revision.action,
        ...revisionShares(revision, memberId, counterpartyId),
        afterLaterPayment: laterThanAPayment(revision.at),
      }));

    statements.push({
      counterpartyMemberId: counterpartyId,
      counterpartyName: counterparty.name,
      removed: counterparty.removed,
      net: runningNet,
      events,
      removedRevisions,
    });
  }

  return statements.sort(
    (a, b) =>
      Math.abs(b.net) - Math.abs(a.net) || a.counterpartyName.localeCompare(b.counterpartyName, "vi"),
  );
}
