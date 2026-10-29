/** Agente bash servido em /api/agent/script. Sem dependências além de bash, curl e awk; Docker é opcional. */
export const AGENT_VERSION = "1.0.0";

export const AGENT_SCRIPT = `#!/usr/bin/env bash
# ID System Universe — agente de monitoramento v${AGENT_VERSION}
# Uso:  ISU_URL=https://seu-painel ISU_TOKEN=isu_... bash isu-agent.sh [--once] [--install]
set -u
VERSION="${AGENT_VERSION}"
INTERVAL="\${ISU_INTERVAL:-15}"
URL="\${ISU_URL:-}"; TOKEN="\${ISU_TOKEN:-}"
[ -z "$URL" ] || [ -z "$TOKEN" ] && { echo "Defina ISU_URL e ISU_TOKEN." >&2; exit 1; }
URL="\${URL%/}"

if [ "\${1:-}" = "--install" ]; then
  [ "$(id -u)" = 0 ] || { echo "Rode como root para instalar o serviço." >&2; exit 1; }
  install -m 0755 "$0" /usr/local/bin/isu-agent
  umask 077
  printf 'ISU_URL=%s\\nISU_TOKEN=%s\\n' "$URL" "$TOKEN" > /etc/isu-agent.env
  cat > /etc/systemd/system/isu-agent.service <<UNIT
[Unit]
Description=ID System Universe agent
After=network-online.target
[Service]
EnvironmentFile=/etc/isu-agent.env
ExecStart=/usr/local/bin/isu-agent
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload && systemctl enable --now isu-agent && echo "Agente instalado e em execução."
  exit 0
fi

cpu_sample() { awk '/^cpu /{idle=$5+$6; t=0; for(i=2;i<=NF;i++)t+=$i; print idle, t}' /proc/stat; }
net_sample() { awk 'NR>2 && $1 !~ /^(lo|docker|veth|br-)/ {gsub(":","",$1); rx+=$2; tx+=$10} END{print rx+0, tx+0}' /proc/net/dev; }
io_sample() { awk '$3 ~ /^(sd[a-z]+|vd[a-z]+|nvme[0-9]+n[0-9]+|xvd[a-z]+)$/ {r+=$6; w+=$10} END{print r*512, w*512}' /proc/diskstats; }
json_str() { printf '%s' "$1" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g' | tr -d '\\n\\r\\t'; }

read -r IDLE0 TOT0 < <(cpu_sample); read -r RX0 TX0 < <(net_sample); read -r RD0 WR0 < <(io_sample)
T0=$(date +%s.%N)
OS=$(. /etc/os-release 2>/dev/null && echo "\${PRETTY_NAME:-linux}" || echo linux)
KERNEL=$(uname -r); HOST=$(hostname)
CORES=$(nproc 2>/dev/null || echo 1)
MODEL=$(awk -F: '/model name/{gsub(/^ +/,"",$2); print $2; exit}' /proc/cpuinfo)

collect() {
  sleep "$1"
  read -r IDLE1 TOT1 < <(cpu_sample); read -r RX1 TX1 < <(net_sample); read -r RD1 WR1 < <(io_sample)
  local t1 dt
  t1=$(date +%s.%N); dt=$(awk -v a="$T0" -v b="$t1" 'BEGIN{d=b-a; print (d<0.1?0.1:d)}')
  local cpu net_rx net_tx rd wr
  cpu=$(awk -v i0="$IDLE0" -v i1="$IDLE1" -v t0="$TOT0" -v t1="$TOT1" 'BEGIN{dt=t1-t0; if(dt<=0){print 0}else{printf "%.1f", 100*(1-(i1-i0)/dt)}}')
  net_rx=$(awk -v a="$RX0" -v b="$RX1" -v d="$dt" 'BEGIN{v=(b-a)/d; printf "%.0f", v<0?0:v}')
  net_tx=$(awk -v a="$TX0" -v b="$TX1" -v d="$dt" 'BEGIN{v=(b-a)/d; printf "%.0f", v<0?0:v}')
  rd=$(awk -v a="$RD0" -v b="$RD1" -v d="$dt" 'BEGIN{v=(b-a)/d; printf "%.0f", v<0?0:v}')
  wr=$(awk -v a="$WR0" -v b="$WR1" -v d="$dt" 'BEGIN{v=(b-a)/d; printf "%.0f", v<0?0:v}')
  IDLE0=$IDLE1; TOT0=$TOT1; RX0=$RX1; TX0=$TX1; RD0=$RD1; WR0=$WR1; T0=$t1

  local load mem swap disk uptime procs
  load=$(awk '{printf "%s,%s,%s", $1,$2,$3}' /proc/loadavg)
  procs=$(awk '{split($4,a,"/"); print a[2]}' /proc/loadavg)
  mem=$(awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}/SwapTotal/{st=$2}/SwapFree/{sf=$2}END{printf "%d,%d,%d,%d", t/1024,(t-a)/1024,st/1024,(st-sf)/1024}' /proc/meminfo)
  disk=$(df -Pm / | awk 'NR==2{printf "%d,%d", $2,$3}')
  uptime=$(awk '{printf "%d",$1}' /proc/uptime)

  local containers="[]" total=0
  if command -v docker >/dev/null 2>&1; then
    total=$(docker ps -aq 2>/dev/null | wc -l | tr -d ' ')
    local rows
    rows=$(docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}' 2>/dev/null | awk -F'|' '
      function mb(s,  v,u){ v=s+0; u=s; gsub(/[0-9.]/,"",u); if(u ~ /^GiB/)return v*1024; if(u ~ /^KiB/)return v/1024; if(u ~ /^B/)return v/1048576; return v }
      { split($3,m," / "); gsub(/%/,"",$2); gsub(/%/,"",$4);
        printf "%s{\\"name\\":\\"%s\\",\\"cpuPercent\\":%.1f,\\"memMb\\":%.0f,\\"memPercent\\":%.1f}", (NR>1?",":""), $1, $2+0, mb(m[1]), $4+0 }')
    containers="[$rows]"
  fi

  IFS=, read -r l1 l5 l15 <<< "$load"
  IFS=, read -r mt mu st su <<< "$mem"
  IFS=, read -r dt_ du <<< "$disk"
  printf '{"agentVersion":"%s","hostname":"%s","os":"%s","kernel":"%s","cpuModel":"%s","cpuCores":%s,"uptimeSec":%s,"cpuPercent":%s,"load":[%s,%s,%s],"mem":{"totalMb":%s,"usedMb":%s,"swapTotalMb":%s,"swapUsedMb":%s},"disk":{"totalMb":%s,"usedMb":%s},"net":{"rxBps":%s,"txBps":%s},"diskIo":{"readBps":%s,"writeBps":%s},"procs":%s,"containersTotal":%s,"containers":%s}' \\
    "$VERSION" "$(json_str "$HOST")" "$(json_str "$OS")" "$(json_str "$KERNEL")" "$(json_str "$MODEL")" "$CORES" "$uptime" "$cpu" "$l1" "$l5" "$l15" "$mt" "$mu" "$st" "$su" "$dt_" "$du" "$net_rx" "$net_tx" "$rd" "$wr" "\${procs:-0}" "$total" "$containers"
}

send() {
  curl -sS -m 20 -o /tmp/isu-agent.out -w '%{http_code}' -X POST "$URL/api/agent/metrics" \\
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary @-
}

if [ "\${1:-}" = "--once" ]; then
  code=$(collect 2 | send); echo "HTTP $code $(cat /tmp/isu-agent.out 2>/dev/null)"; [ "$code" = 200 ] && exit 0 || exit 1
fi

while true; do
  code=$(collect "$INTERVAL" | send) || true
  [ "$code" = 200 ] || echo "isu-agent: envio falhou (HTTP \${code:-erro}) $(cat /tmp/isu-agent.out 2>/dev/null)" >&2
done
`;
