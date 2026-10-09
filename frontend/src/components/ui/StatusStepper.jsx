import './ui.css';
import '../../styles/animations.css';
import { useI18n } from '../../i18n';

const DEFAULT_STEPS = [
  { id: 'Reported', labelKey: 'stepper.reported', fallback: 'Reported' },
  { id: 'Prioritized', labelKey: 'stepper.prioritized', fallback: 'Prioritized' },
  { id: 'Assigned', labelKey: 'stepper.assigned', fallback: 'Assigned' },
  { id: 'In Progress', labelKey: 'stepper.inProgress', fallback: 'In Progress' },
  { id: 'Resolved', labelKey: 'stepper.resolved', fallback: 'Resolved' }
];

export function StatusStepper({
  currentStatus = 'Reported',
  steps = DEFAULT_STEPS,
  className = ''
}) {
  const { t } = useI18n();

  // Find step index
  let activeIndex = steps.findIndex(
    (s) => s.id.toLowerCase() === String(currentStatus).toLowerCase()
  );
  if (activeIndex === -1) {
    if (String(currentStatus).toLowerCase() === 'pending') activeIndex = 0;
    else if (String(currentStatus).toLowerCase() === 'active') activeIndex = 1;
    else activeIndex = 0;
  }

  const progressPercent = steps.length > 1 ? (activeIndex / (steps.length - 1)) * 100 : 0;

  return (
    <div
      className={`ss-stepper ${className}`}
      role="region"
      aria-label="Incident Status Progress"
    >
      <div className="ss-stepper-track" aria-hidden="true">
        <div
          className="ss-stepper-progress"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {steps.map((step, idx) => {
        const isCompleted = idx < activeIndex;
        const isActive = idx === activeIndex;
        const statusClass = isCompleted ? 'completed' : isActive ? 'active' : 'pending';

        return (
          <div
            key={step.id}
            className={`ss-stepper-step ${statusClass}`}
            aria-current={isActive ? 'step' : undefined}
          >
            <div className="ss-stepper-circle" aria-hidden="true">
              {isCompleted ? '✓' : idx + 1}
            </div>
            <span className="ss-stepper-label">
              {t(step.labelKey) || step.fallback}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default StatusStepper;
