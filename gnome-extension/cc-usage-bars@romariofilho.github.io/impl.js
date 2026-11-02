// Claude Code usage bars in the GNOME top panel.
//
//   ↻ 1h47 ▰▰▱▱▱▱ 27%  ·  ↻ Thu ▰▱▱▱▱▱ 10% (-32%)
//
// Same colors/bands as statusline/statusline.sh. Data: the attributes of the Home Assistant
// sensor fed by the claude_usage webhook (see ../../homeassistant/claude_usage.yaml).
// Config: ~/.config/cc-usage-bars/config.json  (see config.example.json)

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

const CONFIG_PATH =GLib.build_filenamev([GLib.get_user_config_dir(), 'cc-usage-bars', 'config.json']);

const DEFAULTS = {
    url: 'http://homeassistant.local:8123',
    token: '',
    ssh: '',
    entity: 'sensor.claude_code_sessao',
    refreshSeconds: 60,
    staleMinutes: 30,
    barWidth: 54,
    barHeight: 22,
    fontSize: 13,
    deepseekEntity: 'sensor.deepseek_saldo',  // '' to hide
    deepseekYellow: 2, deepseekRed: 1,
    sessionYellow: 40, sessionRed: 75,
    paceYellow: 90, paceRed: 100,
};

const GREEN = '#4ec36b', YELLOW = '#e5c03a', RED = '#e5534b', DIM = 'rgba(255,255,255,0.55)';
const WEEK_MS = 7 * 24 * 3600 * 1000;

function loadConfig() {
    try {
        const [ok, bytes] = GLib.file_get_contents(CONFIG_PATH);
        if (ok)
            return {...DEFAULTS, ...JSON.parse(new TextDecoder().decode(bytes))};
    } catch (e) {
        // missing/invalid file: defaults, the menu explains what is wrong
    }
    return {...DEFAULTS};
}

const pad2 = n => String(n).padStart(2, '0');
const parseDate = s => {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
};

// extension.js re-imports this module on every enable() (see there), so each load needs its own GType name
const LOAD_ID = Date.now();
console.log(`cc-usage-bars: module loaded (${LOAD_ID})`);

class Indicator extends PanelMenu.Button {
    static {
        GObject.registerClass({GTypeName: `CCUsageBarsIndicator_${LOAD_ID}`}, this);
    }

    constructor() {
        super(0.0, 'Claude Code usage bars');

        this._cfg = loadConfig();
        this._data = null;
        this._error = null;
        this._cancellable = new Gio.Cancellable();
        this._session = new Soup.Session({timeout: 10});

        this._box = new St.BoxLayout({y_align: Clutter.ActorAlign.CENTER, style: 'spacing: 6px;'});
        this.add_child(this._box);

        this._sessionItem = this._buildItem();
        this._sep = new St.Label({text: '·', y_align: Clutter.ActorAlign.CENTER, style: `color: ${DIM};`});
        this._weekItem = this._buildItem();
        this._box.add_child(this._sessionItem.box);
        this._box.add_child(this._sep);
        this._box.add_child(this._weekItem.box);
        this._dsSep = new St.Label({text: '·', y_align: Clutter.ActorAlign.CENTER, style: `color: ${DIM};`});
        this._dsLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this._box.add_child(this._dsSep);
        this._box.add_child(this._dsLabel);

        this._lines = {};
        for (const k of ['session', 'week', 'deepseek', 'plan', 'updated', 'error']) {
            this._lines[k] = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
            this.menu.addMenuItem(this._lines[k]);
        }
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction('Atualizar agora', () => this._refresh());
        this.menu.addAction('Abrir configuração', () => {
            Gio.AppInfo.launch_default_for_uri(`file://${CONFIG_PATH}`, null);
        });

        this._render();
        this._refresh();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, Math.max(15, this._cfg.refreshSeconds), () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _buildItem() {
        const {barWidth: w, barHeight: h} = this._cfg;
        const box = new St.BoxLayout({y_align: Clutter.ActorAlign.CENTER, style: 'spacing: 5px;'});
        const label = new St.Label({y_align: Clutter.ActorAlign.CENTER, style: `color: ${DIM};`});
        // gauge: track + fill stacked, the percentage centered on top of both
        const track = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
            style: `width: ${w}px; height: ${h}px; border-radius: ${h / 2}px; background-color: rgba(255,255,255,0.2);`,
        });
        // a horizontal box always starts its child at the left edge (BinLayout alignment did not)
        const lane = new St.BoxLayout({x_expand: true, y_expand: true});
        const fill = new St.Widget({y_expand: true, style: 'width: 0px;'});
        lane.add_child(fill);
        const pct = new St.Label({
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
            style: `font-size: ${this._cfg.fontSize}px; font-weight: bold; color: white; text-shadow: 0 0 2px rgba(0,0,0,0.9);`,
        });
        track.add_child(lane);
        track.add_child(pct);
        const delta = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        for (const a of [label, track, delta])
            box.add_child(a);
        return {box, label, fill, pct, delta};
    }

    _setItem(item, {label, pct, color, delta}) {
        const {barWidth: w, barHeight: h} = this._cfg;
        const p = Math.max(0, Math.min(100, pct));
        item.label.text = label;
        item.fill.style = `width: ${Math.round(w * p / 100)}px; border-radius: ${h / 2}px; background-color: ${color};`;
        item.pct.text = `${Math.round(p)}%`;
        item.delta.text = delta ?? '';
        item.delta.style = `color: ${color};`;
        item.delta.visible = !!delta;
    }

    _band(p) {
        const c = this._cfg;
        return p > c.sessionRed ? RED : (p >= c.sessionYellow ? YELLOW : GREEN);
    }

    _sessionView(p, resetsMs, now) {
        let label = '5h';
        if (resetsMs !== null) {
            const m = Math.max(0, Math.floor((resetsMs - now + 59999) / 60000));
            label = `↻ ${Math.floor(m / 60)}h${pad2(m % 60)}`;
        }
        return {label, pct: p, color: this._band(p), delta: ''};
    }

    _weekView(p, resetsMs, now) {
        const c = this._cfg;
        let color = this._band(p), delta = '', label = '7d';
        if (resetsMs !== null) {
            const f = Math.min(1, 1 - (resetsMs - now) / WEEK_MS);
            if (f >= 0.02) {
                const proj = p / f;
                color = proj > c.paceRed ? RED : (proj >= c.paceYellow ? YELLOW : GREEN);
                const dv = p - f * 100;
                delta = `${dv >= 0 ? '+' : '-'}${Math.round(Math.abs(dv))}%`;
            }
            const d = new Date(resetsMs);
            const sameDay = d.toDateString() === new Date(now).toDateString();
            label = `↻ ${sameDay
                ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
                : d.toLocaleDateString(undefined, {weekday: 'short'}).replace(/\.$/, '')}`;
        }
        return {label, pct: p, color, delta};
    }

    _render() {
        const now = Date.now();
        const d = this._data;
        const stale = d && d.updatedMs !== null && now - d.updatedMs > this._cfg.staleMinutes * 60000;

        if (!d) {
            this._setItem(this._sessionItem, {label: 'CC', pct: 0, color: DIM, delta: ''});
            this._sessionItem.pct.text = this._error ? '⚠' : '…';
            this._weekItem.box.visible = false;
            this._sep.visible = false;
        } else {
            this._setItem(this._sessionItem, this._sessionView(d.sessionPct, d.sessionResets, now));
            this._weekItem.box.visible = d.weekPct !== null;
            this._sep.visible = d.weekPct !== null;
            if (d.weekPct !== null)
                this._setItem(this._weekItem, this._weekView(d.weekPct, d.weekResets, now));
            this._box.opacity = stale ? 110 : 255;
        }

        const bal = d?.balance ?? null;
        const c = this._cfg;
        this._dsSep.visible = this._dsLabel.visible = bal !== null;
        if (bal !== null) {
            this._dsLabel.text = `🐳 $${bal.toFixed(2)}`;
            this._dsLabel.style = `color: ${bal < c.deepseekRed ? RED : (bal < c.deepseekYellow ? YELLOW : 'white')};`;
        }
        this._lines.deepseek.visible = bal !== null;
        this._lines.deepseek.label.text = bal !== null ? `DeepSeek: saldo $${bal.toFixed(2)}` : '';

        const fmt = ms => ms === null ? '?' : new Date(ms).toLocaleString(undefined,
            {weekday: 'short', hour: '2-digit', minute: '2-digit'});
        this._lines.session.label.text = d ? `Sessão (5 h): ${Math.round(d.sessionPct)}% · renova ${fmt(d.sessionResets)}` : 'Sessão (5 h): —';
        this._lines.week.label.text = d && d.weekPct !== null
            ? `Semana (7 d): ${Math.round(d.weekPct)}% · renova ${fmt(d.weekResets)}` : 'Semana (7 d): —';
        this._lines.plan.label.text = d ? `Plano: ${d.plan || '?'}` : 'Plano: —';
        this._lines.updated.label.text = d && d.updatedMs !== null
            ? `Atualizado: ${new Date(d.updatedMs).toLocaleTimeString()}${stale ? '  ⚠ desatualizado' : ''}` : 'Atualizado: —';
        this._lines.error.visible = !!this._error;
        this._lines.error.label.text = this._error ? `⚠ ${this._error}` : '';
    }

    async _fetchRest(c, entity) {
        const msg = Soup.Message.new('GET', `${c.url.replace(/\/$/, '')}/api/states/${entity}`);
        msg.request_headers.append('Authorization', `Bearer ${c.token}`);
        const bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, this._cancellable);
        if (msg.get_status() !== Soup.Status.OK)
            throw new Error(`HTTP ${msg.get_status()}`);
        return new TextDecoder().decode(bytes.get_data());
    }

    // HAOS "Advanced SSH & Web Terminal" add-on: $SUPERVISOR_TOKEN reaches the Core API,
    // so no long-lived token has to be stored on this machine.
    async _fetchSsh(c, entities) {
        const remote = entities.map(e =>
            `curl -s -m 8 -H "Authorization: Bearer $SUPERVISOR_TOKEN" http://supervisor/core/api/states/${e}`)
            .join('; echo; ');
        const proc = Gio.Subprocess.new(
            ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', c.ssh, remote],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        const [out, err] = await proc.communicate_utf8_async(null, this._cancellable);
        if (!proc.get_successful())
            throw new Error(`ssh: ${(err || '').trim().split('\n')[0] || `exit ${proc.get_exit_status()}`}`);
        return out.split('\n').filter(l => l.trim());
    }

    // main sensor (required) + DeepSeek balance (optional: a failure there is ignored)
    async _fetchAll(c) {
        const ds = c.deepseekEntity;
        if (c.ssh) {
            const [main, bal = ''] = await this._fetchSsh(c, ds ? [c.entity, ds] : [c.entity]);
            return {main, ds: bal};
        }
        const bal = ds ? this._fetchRest(c, ds).catch(() => '') : Promise.resolve('');
        return {main: await this._fetchRest(c, c.entity), ds: await bal};
    }

    async _refresh() {
        const c = this._cfg = loadConfig();
        if (!c.ssh && !c.token) {
            this._error = `sem token nem ssh: edite ${CONFIG_PATH}`;
            this._data = null;
            this._render();
            return;
        }
        try {
            const {main, ds} = await this._fetchAll(c);
            const j = JSON.parse(main);
            let balance = null;
            try {
                const b = parseFloat(JSON.parse(ds).state);
                balance = Number.isNaN(b) ? null : b;
            } catch (e) {
                // no DeepSeek sensor: just hide it
            }
            const sp = parseFloat(j.state);
            if (Number.isNaN(sp))
                throw new Error(`sensor ${j.state}`);
            const a = j.attributes ?? {};
            const wp = parseFloat(a.semana_pct);
            this._data = {
                sessionPct: sp,
                sessionResets: parseDate(a.renova_em),
                weekPct: Number.isNaN(wp) ? null : wp,
                weekResets: parseDate(a.semana_renova_em),
                plan: a.plano ?? '',
                balance,
                updatedMs: parseDate(a.atualizado_em) ?? parseDate(j.last_updated),
            };
            this._error = null;
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            this._error = String(e.message ?? e);
            console.warn(`cc-usage-bars: ${this._error}`);
        }
        this._render();
    }

    destroy() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = null;
        }
        this._cancellable.cancel();
        this._session.abort();
        super.destroy();
    }
}

export function enable(extension) {
    const indicator = new Indicator();
    Main.panel.addToStatusArea(extension.uuid, indicator, 0, 'right');
    return indicator;
}

export function disable(indicator) {
    indicator?.destroy();
}
