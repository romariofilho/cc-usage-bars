// Thin loader. GNOME Shell caches ES modules by URL, so editing the code and doing
// `gnome-extensions disable/enable` would keep running the old version until the next login
// (on Wayland the shell cannot be restarted). Importing impl.js with a changing query string
// makes every enable() load a fresh copy, so edits apply with a disable/enable cycle.
// Each reload leaves the previous (tiny) module in memory until the next login.

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class CCUsageBarsExtension extends Extension {
    async enable() {
        const token = this._token = {};
        const mod = await import(`${this.dir.get_uri()}/impl.js?v=${Date.now()}`);
        if (this._token !== token)  // disabled while the import was pending
            return;
        this._mod = mod;
        this._indicator = mod.enable(this);
    }

    disable() {
        this._token = null;
        this._mod?.disable(this._indicator);
        this._mod = null;
        this._indicator = null;
    }
}
