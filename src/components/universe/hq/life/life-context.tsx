"use client";

import { createContext, useContext } from "react";
import type { LifeSim } from "./sim";

/** A simulação visual da cena (uma só). Fica fora da árvore React de dados: quem precisa lê o objeto mutável a cada frame. */
export const LifeContext = createContext<LifeSim | null>(null);

export function useLife(): LifeSim | null {
  return useContext(LifeContext);
}
