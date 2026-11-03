import { LEAD_STAGES, type LeadStage } from '../db/schema/index.js';

export { LEAD_STAGES, type LeadStage };

// The part of the funnel Moni drives. Visit stages belong to the booking flow (Milestone 3) and
// opted_out is set only by optOut.
const MONI_PATH: LeadStage[] = ['new', 'engaged', 'qualified', 'recommended', 'visit_proposed'];

export const MONI_SETTABLE_STAGES = ['engaged', 'qualified', 'recommended', 'visit_proposed', 'lost'] as const;

export function canMoniSetStage(from: LeadStage, to: LeadStage): boolean {
  if (from === 'lost') return to === 'engaged';
  // After a cancelled or missed visit, Moni may offer another one or let the lead go.
  if (from === 'cancelled' || from === 'no_show') return to === 'visit_proposed' || to === 'lost';
  const i = MONI_PATH.indexOf(from);
  if (i < 0) return false;
  if (to === 'lost') return true;
  const j = MONI_PATH.indexOf(to);
  return j > i;
}
