"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Entrada/saída de painéis laterais: desliza ~40px e some em fade (transform + opacity, aceleradas
 * por GPU). Sob `prefers-reduced-motion` o <MotionConfig reducedMotion="user"> da raiz tira o
 * deslize e deixa só o fade. O wrapper não captura cliques fora do painel.
 */
export function MotionPanelSlot({ panelKey, children }: { panelKey: string | null; children: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {panelKey && (
        <motion.div
          key={panelKey}
          className="pointer-events-none absolute inset-0 z-20 overflow-hidden [&>*]:pointer-events-auto"
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ type: "spring", visualDuration: 0.32, bounce: 0 }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
