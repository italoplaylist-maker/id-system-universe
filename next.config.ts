import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for the Docker image (see Dockerfile) — produces .next/standalone
  // with only the files actually needed to run `node server.js`.
  output: "standalone",
  // O Claude Agent SDK carrega um binário nativo em tempo de execução: não pode ser empacotado.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
  // Anexos (imagens/arquivos): o proxy guarda o corpo da requisição em memória; o padrão (10 MB) cortaria arquivos maiores.
  // `webpackMemoryOptimizations` baixa o pico de memória do webpack (custa poucos segundos de build).
  experimental: { proxyClientMaxBodySize: "30mb", webpackMemoryOptimizations: true },
  typescript: {
    // O build do servidor morria na etapa "Running TypeScript" (falta de memória: o servidor é um só e divide a RAM com o
    // Universe em execução e com os agentes). A checagem de tipos NÃO some: o CI (.github/workflows/ci.yml) roda `tsc --noEmit`
    // em todo PR e o merge dos agentes só passa com ele verde — é o que o guia de memória do Next recomenda.
    // Se algum dia um merge for feito com o CI vermelho, os erros de tipo chegariam à produção: não faça isso.
    ignoreBuildErrors: true,
  },
  outputFileTracingIncludes: { "/*": ["./node_modules/@anthropic-ai/claude-agent-sdk*/**/*", "./skill-packs/**/*"] },
};

export default nextConfig;
