/* cc-usage-card: Claude Code plan usage on one line, as gauges with the percentage inside.
 *
 *   ↻ 1h47 [▓▓ 27%] · ↻ qui [▓▓▓▓ 60%] +6% · DS $5.59
 *
 * Same colors/logic as statusline/statusline.sh (session by usage band, week by pace) and the
 * markdown card in card_usage.md.j2. Reads the attributes of sensor.claude_code_sessao
 * (claude_usage.yaml) and, optionally, sensor.deepseek_saldo.
 *
 * Copy to /config/www/ and add the resource  url: /local/cc-usage-card.js  type: module
 *
 * type: custom:cc-usage-card
 * entity: sensor.claude_code_sessao        # default
 * deepseek_entity: sensor.deepseek_saldo   # default; '' hides it
 * deepseek_icon: /local/deepseek.svg       # default; '' shows "DS" text instead
 * size: normal | large                     # large for wall displays (nest_hub)
 * radius: 0                                # gauge corner radius in px (0 = square)
 * track_color: '#4B5563'                   # unfilled part of the gauge
 */
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const GREEN = '#2EC27E', YELLOW = '#F5C211', RED = '#E01B24', AMBER = '#E5A50A';
const WEEK_MS = 7 * 24 * 3600 * 1000;

const num = v => {
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
};
const ms = v => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? null : t;
};
const clamp = p => Math.max(0, Math.min(100, p));

// session / extra: by usage band
const bandColor = p => (p > 75 ? RED : p >= 40 ? YELLOW : GREEN);

// weekly: by pace (projected usage at the end of the window if the rate holds)
function paceColor(p, resetsMs, now) {
  const f = resetsMs === null ? 0 : 1 - (resetsMs - now) / WEEK_MS;
  if (f < 0.02) return bandColor(p);
  const proj = p / Math.min(f, 1);
  return proj > 100 ? RED : proj >= 90 ? YELLOW : GREEN;
}

function paceDelta(p, resetsMs, now) {
  const f = resetsMs === null ? 0 : 1 - (resetsMs - now) / WEEK_MS;
  if (f < 0.02) return '';
  const dv = p - Math.min(f, 1) * 100;
  return `${dv >= 0 ? '+' : '-'}${Math.round(Math.abs(dv))}%`;
}

function timeLeft(resetsMs, now) {
  if (resetsMs === null) return '5h';
  const m = Math.max(0, Math.ceil((resetsMs - now) / 60000));
  return `↻ ${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
}

function resetDay(resetsMs, now) {
  if (resetsMs === null) return 'sem';
  const d = new Date(resetsMs);
  if (d.toDateString() === new Date(now).toDateString())
    return `↻ ${d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}`;
  return `↻ ${DIAS[d.getDay()]}`;
}

class CCUsageCard extends HTMLElement {
  setConfig(config) {
    this._config = {
      entity: 'sensor.claude_code_sessao',
      deepseek_entity: 'sensor.deepseek_saldo',
      deepseek_icon: '/local/deepseek.svg',
      size: 'normal',
      radius: 0,  // gauge corner radius in px; 0 = square
      track_color: '#4B5563',  // unfilled part of the gauge
      ...config,
    };
    if (!this.shadowRoot) this.attachShadow({mode: 'open'});
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 1;
  }

  // Browser clock may be off: take the time from the HA server (HTTP Date header) and keep the offset.
  _syncClock() {
    const t0 = Date.now();
    if (this._clockAt && t0 - this._clockAt < 600000) return;
    this._clockAt = t0;
    fetch('/manifest.json', {cache: 'no-store'}).then(r => {
      const d = Date.parse(r.headers.get('Date'));
      if (Number.isNaN(d)) return;
      const t1 = Date.now();
      // Date has 1 s resolution (truncated): add 0.5 s, compare with the request midpoint
      this._offset = d + 500 - (t0 + t1) / 2;
      this._render();
    }).catch(() => {});
  }

  _items(now) {
    const st = this._hass?.states?.[this._config.entity];
    if (!st) return null;
    const a = st.attributes || {};
    const items = [];
    const p0 = num(st.state);
    if (p0 !== null)
      items.push({label: timeLeft(ms(a.renova_em), now), pct: p0, color: bandColor(p0)});
    const addWeek = (pct, resets, suffix, delta) => {
      const p = num(pct);
      if (p === null) return;
      const r = ms(resets);
      items.push({label: resetDay(r, now) + suffix, pct: p, color: paceColor(p, r, now),
                  delta: delta ? paceDelta(p, r, now) : ''});
    };
    addWeek(a.semana_pct, a.semana_renova_em, '', true);
    addWeek(a.semana_opus_pct, a.semana_opus_renova_em, ' O', false);
    addWeek(a.semana_sonnet_pct, a.semana_sonnet_renova_em, ' S', false);
    if (a.extra_ativo === true || a.extra_ativo === 'True') {
      const p = num(a.extra_pct) ?? 0;
      items.push({label: 'ext', pct: p, color: bandColor(p)});
    }
    return {items, updated: ms(a.atualizado_em)};
  }

  _render() {
    if (!this._config || !this._hass || !this.shadowRoot) return;
    this._syncClock();
    const now = Date.now() + (this._offset || 0);
    const big = this._config.size === 'large';
    const h = big ? 28 : 20, w = big ? 68 : 54, fs = big ? 15 : 12, lfs = big ? 18 : 14;

    const data = this._items(now);
    const parts = [];
    if (!data) {
      parts.push(`<span class="warn">Sensor ${this._config.entity} indisponível</span>`);
    } else {
      for (const it of data.items) {
        const p = clamp(it.pct);
        parts.push(`<span class="it"><span class="lbl">${it.label}</span>
          <span class="gauge"><span class="fill" style="width:${p}%;background:${it.color}"></span>
            <span class="pct">${Math.round(p)}%</span></span>
          ${it.delta ? `<span class="dl" style="color:${it.color}">${it.delta}</span>` : ''}</span>`);
      }
      const dsId = this._config.deepseek_entity;
      const ds = dsId && this._hass.states[dsId];
      const bal = ds ? num(ds.state) : null;
      if (bal !== null) {
        const ok = ds.attributes.disponivel !== false && ds.attributes.disponivel !== 'False';
        const color = !ok || bal < 1 ? RED : bal < 2 ? YELLOW : 'inherit';
        const icon = this._config.deepseek_icon
          ? `<img src="${this._config.deepseek_icon}" height="${big ? 18 : 16}" alt="DS">` : 'DS';
        parts.push(`<span class="it"><span class="ds">${icon}</span>
          <span class="bal" style="color:${color}">$${bal.toFixed(2)}</span></span>`);
      }
      if (data.updated !== null && now - data.updated > 30 * 60000)
        parts.push(`<span class="warn">⚠</span>`);
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .line { display: flex; flex-wrap: wrap; justify-content: center; align-items: center;
                gap: ${big ? 8 : 6}px ${big ? 26 : 16}px; padding: ${big ? 6 : 4}px 0; }
        .it { display: inline-flex; align-items: center; gap: ${big ? 8 : 5}px; }
        .lbl, .ds { font-size: ${lfs}px; color: var(--secondary-text-color); white-space: nowrap; }
        .ds { display: inline-flex; align-items: center; line-height: 0; }
        .ds img { display: block; }
        .gauge { position: relative; display: inline-block; width: ${w}px; height: ${h}px;
                 border-radius: ${this._config.radius}px; overflow: hidden;
                 background: ${this._config.track_color}; }
        .fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: ${this._config.radius}px; }
        .pct { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
               font-size: ${fs}px; font-weight: 700; color: #fff; text-shadow: 0 0 3px rgba(0,0,0,.85); }
        .dl { font-size: ${big ? 14 : 12}px; font-weight: 600; }
        .bal { font-size: ${lfs}px; font-weight: 700; }
        .warn { font-size: ${lfs}px; color: ${AMBER}; }
      </style>
      <div class="line">${parts.join('')}</div>`;
  }
}

if (!customElements.get('cc-usage-card')) customElements.define('cc-usage-card', CCUsageCard);
window.customCards = window.customCards || [];
window.customCards.push({type: 'cc-usage-card', name: 'Claude Code usage', description: 'Plan usage gauges on one line, % inside'});
