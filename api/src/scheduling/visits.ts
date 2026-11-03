import type { visits } from '../db/schema/index.js';

export type Visit = typeof visits.$inferSelect;

export type VisitView = Visit & {
  salesName: string;
  salesPhone: string;
  projectName: string;
  mapsUrl: string | null;
  // wibLabel(startsAt), e.g. "Jumat, 30 Oktober 2026 10.00 WIB".
  label: string;
};

// `previous` is the row before the change; for a reschedule it is the old row.
export type VisitChange = {
  kind: 'booked' | 'rescheduled' | 'cancelled' | 'reassigned' | 'outcome';
  visit: Visit;
  previous: Visit | null;
};
