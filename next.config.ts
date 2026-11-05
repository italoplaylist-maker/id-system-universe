import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for the Docker image (see Dockerfile) — produces .next/standalone
  // with only the files actually needed to run `node server.js`.
  output: "standalone",
  // O Claude Agent SDK carrega um binário nativo em tempo de execução: não pode ser empacotado.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
  // Anexos (imagens/arquivos): o proxy guarda o corpo da requisição em memória; o padrão (10 MB) cortaria arquivos maiores.
  experimental: { proxyClientMaxBodySize: "30mb" },
  outputFileTracingIncludes: { "/*": ["./node_modules/@anthropic-ai/claude-agent-sdk*/**/*"] },
};

export default nextConfig;
