import { generateK6Script, readLoadStages, totalLoadSeconds } from '../../load/k6-summary';
import { QualityReviewRequired } from './agent-context';

export function prepareK6(url: URL, profile: unknown) {
  const stages = readLoadStages(profile);
  if (!stages || stages.length > 10 || stages.every(stage => stage.target === 0)) {
    throw new QualityReviewRequired('Define un perfil de carga con hasta diez etapas y al menos un usuario virtual.');
  }
  const seconds = totalLoadSeconds(stages);
  if (seconds < 10 || seconds > 30 * 60) {
    throw new QualityReviewRequired('Configura una duración total de 10 segundos a 30 minutos.');
  }

  return generateK6Script({
    url: url.origin + url.pathname,
    stages,
    standalone: { needsQuery: !!url.search },
  });
}
