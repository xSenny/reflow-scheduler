/**
 * Core domain types for the production schedule reflow system.
 *
 * Every persisted entity follows the { docId, docType, data } envelope from the
 * spec. Internally the algorithm mostly works with the `data` payloads plus the
 * docId, so we expose narrowed helper types too.
 *
 * All dates are ISO-8601 strings in UTC ("...Z"). See utils/date-utils.ts for
 * why we treat everything as UTC and avoid timezone/DST handling.
 */

export type DocType = "workOrder" | "workCenter" | "manufacturingOrder";

export interface Doc<TType extends DocType, TData> {
  docId: string;
  docType: TType;
  data: TData;
}

// ---------------------------------------------------------------------------
// Work Order
// ---------------------------------------------------------------------------

export interface WorkOrderData {
  workOrderNumber: string;
  manufacturingOrderId: string;
  workCenterId: string;

  /** ISO-8601 UTC. The *original* scheduled start (input). */
  startDate: string;
  /** ISO-8601 UTC. The *original* scheduled end (input). */
  endDate: string;

  /** Total working time required, in minutes. Excludes shift gaps / maintenance. */
  durationMinutes: number;

  /** Optional setup time (bonus). Counts as working time, runs before production. */
  setupTimeMinutes?: number;

  /** Maintenance work orders are immovable: their times are treated as fixed. */
  isMaintenance: boolean;

  /** All listed parents must fully complete before this order may start. */
  dependsOnWorkOrderIds: string[];
}

export type WorkOrder = Doc<"workOrder", WorkOrderData>;

// ---------------------------------------------------------------------------
// Work Center
// ---------------------------------------------------------------------------

export interface Shift {
  /** 0-6, Sunday = 0 (matches JS Date.getUTCDay()). */
  dayOfWeek: number;
  /** 0-23. Inclusive lower bound of the working window. */
  startHour: number;
  /** 0-23. Exclusive upper bound. Must be > startHour (no overnight shifts). */
  endHour: number;
}

export interface MaintenanceWindow {
  /** ISO-8601 UTC. */
  startDate: string;
  /** ISO-8601 UTC. */
  endDate: string;
  reason?: string;
}

export interface WorkCenterData {
  name: string;
  shifts: Shift[];
  maintenanceWindows: MaintenanceWindow[];
}

export type WorkCenter = Doc<"workCenter", WorkCenterData>;

// ---------------------------------------------------------------------------
// Manufacturing Order (context only)
// ---------------------------------------------------------------------------

export interface ManufacturingOrderData {
  manufacturingOrderNumber: string;
  itemId: string;
  quantity: number;
  dueDate: string;
}

export type ManufacturingOrder = Doc<"manufacturingOrder", ManufacturingOrderData>;

// ---------------------------------------------------------------------------
// Reflow I/O
// ---------------------------------------------------------------------------

export interface ReflowInput {
  workOrders: WorkOrder[];
  workCenters: WorkCenter[];
  manufacturingOrders?: ManufacturingOrder[];
}

/** One row in the change log: what moved and by how much. */
export interface ScheduleChange {
  workOrderId: string;
  workOrderNumber: string;
  originalStart: string;
  originalEnd: string;
  newStart: string;
  newEnd: string;
  /** newEnd - originalEnd, in minutes. Positive = pushed later. */
  startShiftMinutes: number;
  endShiftMinutes: number;
  reasons: string[];
}

/** Optimization / quality metrics (bonus). */
export interface ReflowMetrics {
  /** Σ max(0, newEnd - originalEnd) across all work orders, in minutes. */
  totalDelayMinutes: number;
  /** Count of work orders whose start or end moved. */
  affectedWorkOrders: number;
  /** Per work center: working minutes / available shift minutes in the schedule span. */
  utilization: Record<string, number>;
}

export interface ReflowResult {
  updatedWorkOrders: WorkOrder[];
  changes: ScheduleChange[];
  explanation: string;
  metrics: ReflowMetrics;
}

/** A concrete, resolved time interval (UTC epoch millis) used internally. */
export interface Interval {
  start: number; // epoch ms
  end: number; // epoch ms
}