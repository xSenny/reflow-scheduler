import type { WorkOrder } from "./types";

export class CyclicDependencyError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Circular dependency detected: ${cycle.join(" -> ")}`);
    this.name = "CyclicDependencyError";
  }
}

export class MissingDependencyError extends Error {
  constructor(
    public readonly workOrderId: string,
    public readonly missingParentId: string,
  ) {
    super(`Work order ${workOrderId} depends on unknown work order ${missingParentId}`);
    this.name = "MissingDependencyError";
  }
}

// Sorts work orders so every parent always precedes its children (Kahn's algorithm).
// Throws CyclicDependencyError if a circular dependency is detected.
// Throws MissingDependencyError if a work order references an unknown parent.
export function topologicalSort(workOrders: WorkOrder[]): string[] {
  const byId = new Map<string, WorkOrder>();
  const indegree = new Map<string, number>();
  const children = new Map<string, string[]>();

  for (const wo of workOrders) {
    byId.set(wo.docId, wo);
    indegree.set(wo.docId, 0);
    children.set(wo.docId, []);
  }

  for (const wo of workOrders) {
    for (const parentId of wo.data.dependsOnWorkOrderIds) {
      if (!byId.has(parentId)) throw new MissingDependencyError(wo.docId, parentId);
      indegree.set(wo.docId, indegree.get(wo.docId)! + 1);
      children.get(parentId)!.push(wo.docId);
    }
  }

  // Seed queue with all roots (no dependencies), sorted for deterministic output.
  const queue: string[] = [];
  for (const [id, deg] of indegree) {
    if (deg === 0) queue.push(id);
  }
  queue.sort((a, b) => a.localeCompare(b));

  const result: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);
    for (const child of children.get(id)!) {
      indegree.set(child, indegree.get(child)! - 1);
      if (indegree.get(child) === 0) queue.push(child);
    }
  }

  // If not all nodes were visited, a cycle prevented some from reaching indegree 0.
  if (result.length !== workOrders.length) {
    throw new CyclicDependencyError(findCycle(workOrders, byId));
  }

  return result;
}

// DFS with 3-color marking to find and return the actual cycle path.
// Called only when Kahn's algorithm confirms a cycle exists.
function findCycle(workOrders: WorkOrder[], byId: Map<string, WorkOrder>): string[] {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(
    workOrders.map((wo) => [wo.docId, WHITE]),
  );
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    color.set(id, GRAY);
    stack.push(id);

    for (const parentId of byId.get(id)!.data.dependsOnWorkOrderIds) {
      if (color.get(parentId) === GRAY) {
        const idx = stack.indexOf(parentId);
        return [...stack.slice(idx), parentId];
      }
      if (color.get(parentId) === WHITE) {
        const found = visit(parentId);
        if (found) return found;
      }
    }

    stack.pop();
    color.set(id, BLACK);
    return null;
  };

  for (const wo of workOrders) {
    if (color.get(wo.docId) === WHITE) {
      const found = visit(wo.docId);
      if (found) return found;
    }
  }

  return [];
}