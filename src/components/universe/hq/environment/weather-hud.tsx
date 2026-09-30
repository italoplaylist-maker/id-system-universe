"use client";

import { useState } from "react";
import { useWeather } from "@/hooks/use-weather";
import type { WeatherCondition } from "@/app/api/environment/weather/route";

const CONDITION_ICON: Record<WeatherCondition, string> = {
  ENSOLARADO: "☀",
  PARCIALMENTE_NUBLADO: "⛅",
  NUBLADO: "☁",
  CHUVA: "🌧",
  CHUVA_FORTE: "⛈",
};

const CONDITION_LABEL: Record<WeatherCondition, string> = {
  ENSOLARADO: "Ensolarado",
  PARCIALMENTE_NUBLADO: "Parcialmente nublado",
  NUBLADO: "Nublado",
  CHUVA: "Chuva",
  CHUVA_FORTE: "Chuva forte",
};

function formatHour(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

/** Discreet clock+weather chip — PT-BR, hover for detail, never blocks the Universe if the provider is down. */
export function WeatherHud({ timeLabel }: { timeLabel: string }) {
  const { data } = useWeather();
  const [open, setOpen] = useState(false);
  const weather = data && data.ok ? data : null;

  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface-raised/80 px-3 py-1.5 text-xs text-muted backdrop-blur">
        <span aria-hidden>{weather ? CONDITION_ICON[weather.condition] : "…"}</span>
        {weather && <span>{weather.temperature}°C</span>}
        <span className="text-border">·</span>
        <span>{timeLabel}</span>
      </div>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-md border border-border bg-surface-raised p-3 text-xs shadow-xl">
          {weather ? (
            <>
              <p className="font-semibold text-foreground">{CONDITION_LABEL[weather.condition]}</p>
              <p className="mt-1 text-muted">Temperatura: {weather.temperature}°C</p>
              <p className="text-muted">Umidade: {weather.humidity}%</p>
              <p className="text-muted">Vento: {Math.round(weather.windSpeed)} km/h</p>
              {weather.sunrise && <p className="text-muted">Nascer do sol: {formatHour(weather.sunrise)}</p>}
              {weather.sunset && <p className="text-muted">Pôr do sol: {formatHour(weather.sunset)}</p>}
            </>
          ) : (
            <p className="text-muted">Clima indisponível</p>
          )}
        </div>
      )}
    </div>
  );
}
