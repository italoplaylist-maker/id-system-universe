"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      {/* Uma única configuração de movimento para o app: respeita prefers-reduced-motion (tira transform/layout, mantém opacidade). */}
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </QueryClientProvider>
  );
}
