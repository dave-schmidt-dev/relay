import { Run, Provider, TaskRole, RunStatus } from "./types.js";

export interface RunFilterCriteria {
  project_root?: string;
  provider?: Provider | Provider[];
  role?: TaskRole | TaskRole[];
  status?: RunStatus | RunStatus[];
}

export function filterRuns(runs: Run[], criteria: RunFilterCriteria): Run[] {
  return runs.filter((run) => {
    if (criteria.project_root && run.project_root !== criteria.project_root) {
      return false;
    }

    if (criteria.provider) {
      const providers = Array.isArray(criteria.provider) ? criteria.provider : [criteria.provider];
      if (!providers.includes(run.provider)) {
        return false;
      }
    }

    if (criteria.role) {
      const roles = Array.isArray(criteria.role) ? criteria.role : [criteria.role];
      if (!roles.includes(run.role)) {
        return false;
      }
    }

    if (criteria.status) {
      const statuses = Array.isArray(criteria.status) ? criteria.status : [criteria.status];
      if (!statuses.includes(run.status)) {
        return false;
      }
    }

    return true;
  });
}
