import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

test("Mac mini deployment files provide a relay container and Cloudflare tunnel service", () => {
  assert.ok(existsSync(join(repoRoot, "docker-compose.yml")), "docker-compose.yml should exist");
  assert.ok(existsSync(join(repoRoot, ".env.example")), ".env.example should exist");
  assert.ok(existsSync(join(repoRoot, "docs", "deploy-mac-mini.md")), "Mac mini deployment doc should exist");

  const compose = readRepoFile("docker-compose.yml");
  assert.match(compose, /shellmates-relay/);
  assert.match(compose, /cloudflared/);
  assert.match(compose, /TL_RELAY_BASE_PATH: "\/relay"/);
  assert.match(compose, /TL_RELAY_OPEN: "true"/);
  assert.match(compose, /TL_TRUST_PROXY: "true"/);
  assert.match(compose, /shellmates-data:\/data/);
  assert.match(compose, /127\.0\.0\.1:8788:8787/);

  const envExample = readRepoFile(".env.example");
  assert.match(envExample, /SHELLMATES_HOSTNAME=shellmates\.parktaeyoung\.com/);
  assert.match(envExample, /CLOUDFLARE_TUNNEL_TOKEN=/);
  assert.doesNotMatch(envExample, /eyJ|npm_|sk-/);

  const doc = readRepoFile("docs/deploy-mac-mini.md");
  assert.match(doc, /docker compose up -d/);
  assert.match(doc, /https:\/\/shellmates\.parktaeyoung\.com\/relay\/health/);
  assert.match(doc, /Subdomain: `shellmates`/);
  assert.match(doc, /Path: `\^\/relay`/);
  assert.match(doc, /Service: `http:\/\/shellmates-relay:8787`/);
});

test("Dockerfile healthcheck follows TL_RELAY_BASE_PATH when mounted under /relay", () => {
  const dockerfile = readRepoFile("Dockerfile");
  assert.match(dockerfile, /TL_RELAY_BASE_PATH=\/relay/);
  assert.match(dockerfile, /TL_RELAY_BASE_PATH/);
  assert.match(dockerfile, /\/health/);
  assert.doesNotMatch(dockerfile, /fetch\('http:\/\/127\.0\.0\.1:'\+\(process\.env\.TL_RELAY_PORT\|\|8787\)\+'\/health'\)/);
});

test("GitHub Actions CI/CD deploys only from a Mac mini self-hosted runner", () => {
  const workflowPath = join(repoRoot, ".github", "workflows", "ci-deploy.yml");
  assert.ok(existsSync(workflowPath), "ci-deploy workflow should exist");

  const workflow = readFileSync(workflowPath, "utf8");
  assert.match(workflow, /npm run typecheck/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
  assert.ok(workflow.indexOf("npm run build") < workflow.indexOf("npm test"), "CI must build dist before tests that exercise setup-shellmates.sh");
  assert.match(workflow, /self-hosted/);
  assert.match(workflow, /macOS/);
  assert.match(workflow, /CLOUDFLARE_TUNNEL_TOKEN: \$\{\{ secrets\.CLOUDFLARE_TUNNEL_TOKEN \}\}/);
  assert.match(workflow, /docker compose up -d --build/);
  assert.match(workflow, /curl --fail --silent --show-error http:\/\/127\.0\.0\.1:8788\/relay\/health/);
  assert.doesNotMatch(workflow, /eyJh|npm_|sk-/);

  const doc = readRepoFile("docs/deploy-mac-mini.md");
  assert.match(doc, /self-hosted runner/);
  assert.match(doc, /CLOUDFLARE_TUNNEL_TOKEN/);
});
