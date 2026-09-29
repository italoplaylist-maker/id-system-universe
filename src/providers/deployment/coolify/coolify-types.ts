/**
 * Raw Coolify REST API (v1, `/api/v1`) shapes — only the fields this product
 * reads. Verified against Coolify's own source
 * (github.com/coollabsio/coolify: routes/api.php, app/Http/Controllers/Api/*,
 * app/Models/*) rather than guessed, after an earlier guess (nested
 * `environments[].applications/services/databases` on the project detail
 * endpoint) turned out not to exist in the real API and silently produced
 * zero auto-linked projects in production — see
 * [[Bug - Auto-vinculo de Project a partir da Coolify nunca funcionou, formato da API era inventado]]
 * in the vault. Endpoints are centralized in coolify-client.ts specifically
 * so a mismatch is a one-file fix.
 *
 * The real shape: `GET /projects` returns bare stubs; `GET /projects/{uuid}`
 * adds `environments`, but those environments carry no resources at all —
 * every application/service/database is a separate top-level, team-wide
 * list (`GET /applications`, `/services`, `/databases`) whose items each
 * carry a numeric `environment_id` foreign key. Project membership is
 * resolved by joining on that id, not by nesting.
 */

export interface CoolifyApplicationRaw {
  uuid: string;
  name: string;
  description?: string | null;
  /** Compound field observed as "<state>[:<health>]", e.g. "running:healthy". */
  status: string;
  fqdn?: string | null;
  git_repository?: string | null;
  git_branch?: string | null;
  /** Numeric FK to the owning Environment — only meaningful within this same Coolify instance. */
  environment_id?: number;
}

/** `GET /api/v1/services` and `/services/{uuid}` — one row per compose-style service stack (Coolify doesn't expose its sub-containers at this level, and this product doesn't need them to). */
export interface CoolifyServiceRaw {
  uuid: string;
  name: string;
  description?: string | null;
  /** Same compound "<state>[:<health>]" shape as an application's status, derived by Coolify from the service's containers. */
  status?: string | null;
  environment_id?: number;
}

/** `GET /api/v1/databases` and `/databases/{uuid}` — a unified list across every engine (Postgres/MySQL/MariaDB/MongoDB/Redis/...); the engine itself isn't needed for this product's purposes. */
export interface CoolifyDatabaseRaw {
  uuid: string;
  name: string;
  description?: string | null;
  status?: string | null;
  environment_id?: number;
}

/** An Environment as it appears nested under a Project's detail — metadata only, no nested resources (see file header). */
export interface CoolifyEnvironmentRaw {
  /** Numeric primary key — this is what an Application/Service/Database's `environment_id` points to. */
  id: number;
  uuid: string;
  name: string;
}

export interface CoolifyProjectRaw {
  uuid: string;
  name: string;
  description?: string | null;
}

/** `GET /api/v1/projects/{uuid}` — adds the project's environments (metadata only). */
export interface CoolifyProjectDetailRaw extends CoolifyProjectRaw {
  environments?: CoolifyEnvironmentRaw[];
}

export interface CoolifyLogsRaw {
  logs: string;
}

export interface CoolifyDeploymentRaw {
  deployment_uuid: string;
  application_id?: string;
  application_uuid?: string;
  status: string; // "queued" | "in_progress" | "finished" | "failed" | "cancelled-by-user" ...
  commit?: string | null;
  commit_message?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CoolifyDeployTriggerResponseItem {
  resource_uuid: string;
  deployment_uuid: string;
  message?: string;
}

export interface CoolifyDeployTriggerResponse {
  deployments: CoolifyDeployTriggerResponseItem[];
}

export interface CoolifyActionResponse {
  message?: string;
}

export interface CoolifyVersionResponse {
  version?: string;
}
