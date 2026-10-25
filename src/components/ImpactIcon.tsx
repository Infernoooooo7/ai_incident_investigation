import { Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FindingImpact } from '../diagnostics/types';

const IMPACT_ICONS: Record<FindingImpact, LucideIcon> = {
  'failure-point': OctagonAlert,
  contributing: TriangleAlert,
  observation: Info,
};

export function ImpactIcon({ impact, size = 16 }: { impact: FindingImpact; size?: number }) {
  const Icon = IMPACT_ICONS[impact];
  return <Icon size={size} />;
}
