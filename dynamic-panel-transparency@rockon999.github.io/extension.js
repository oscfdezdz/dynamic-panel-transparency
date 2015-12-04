const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Settings = Me.imports.settings;
const Transitions = Me.imports.transitions;
const Theming = Me.imports.theming;
const Util = Me.imports.util;

const Main = imports.ui.main;
const Lang = imports.lang;
const Config = imports.misc.config;
const Panel = Main.panel;

const Clutter = imports.gi.Clutter;







/* Color Scaling Factor (Byte to Decimal) */
const SCALE_FACTOR = 255.9999999;

/* Gnome Versioning */
const MAJOR_VERSION = parseInt(Config.PACKAGE_VERSION.split('.')[0]);
const MINOR_VERSION = parseInt(Config.PACKAGE_VERSION.split('.')[1]);

/* Initialize */
function init() {

    /* Global Variables */
    //this.tweener = null;
    //this.settings = null;
    //this.settings_manager = null;
    this.transparent = false;
    this.blank = false;

    /* Signal IDs */
    this._lockScreenSig = null;
    this._lockScreenShownSig = null;
    this._overviewShowingSig = null;
    this._overviewHiddenSig = null;
    this._windowMapSig = null;
    this._windowDestroySig = null;
    this._windowMinimizeSig = null;
    this._windowUnminimizeSig = null;
    this._maximizeSig = null;
    this._unmaximizeSig = null;
    this._workspaceSwitchSig = null;
}

function enable() {


    /* Get settings... */
    Settings.init();
    Transitions.init();
    Theming.init();

    Settings.bind_settings();

    /* Set the appropriate tweener */


    /* Add support for older Gnome Shell versions (most likely down to 3.12) */
    if (MAJOR_VERSION == 3 && MINOR_VERSION < 17) {
        this._maximizeSig = global.window_manager.connect('maximize', Lang.bind(this, this._windowUpdated));
        this._unmaximizeSig = global.window_manager.connect('unmaximize', Lang.bind(this, this._windowUpdated));
    } else {
        this._maximizeSig = global.window_manager.connect('hide-tile-preview', Lang.bind(this, this._windowUpdated));
        this._unmaximizeSig = global.window_manager.connect('size-change', Lang.bind(this, this._windowUpdated));
    }

    /* Signal Connections
     * hidden: occurs after the overview is hidden
     * showing: occurs as the overview is opening
     * active-changed: occurs when the screen shield is toggled
     * workspace-switched: occurs after a workspace is switched
     * map: monitors both new windows and unminimizing windows
     * minimize: occurs as the window is minimized
     * unminimize: occurs as the window is unminimized
     * destroy: occurs as the window is destroyed
     */
    this._overviewHiddenSig = Main.overview.connect('hidden', Lang.bind(this, function() {
        _windowUpdated();
    }));
    this._overviewShowingSig = Main.overview.connect('showing', Lang.bind(this, function() {
        if (!this.transparent && !this.blank) {
            Transitions.blank_fade_out();
        } else if (this.transparent && !this.blank) {
            Transitions.blank_fade_out({
                time: 0
            });
        }
    }));
    /* Check to see if the screenShield exists (doesn't if user can't lock) */
    if (Main.screenShield !== null)
        this._lockScreenSig = Main.screenShield.connect('active-changed', Lang.bind(this, this._screenShieldActivated));
    this._workspaceSwitchSig = global.window_manager.connect('switch-workspace', Lang.bind(this, this._workspaceSwitched));
    this._windowMinimizeSig = global.window_manager.connect('minimize', Lang.bind(this, this._windowUpdated));
    this._windowUnminimizeSig = global.window_manager.connect('unminimize', Lang.bind(this, this._windowUpdated));
    this._windowMapSig = global.window_manager.connect('map', Lang.bind(this, this._windowUpdated));
    this._windowDestroySig = global.window_manager.connect('destroy', Lang.bind(this, function(wm, window_actor) {
        this._windowUpdated({
            excluded_window: window_actor.get_meta_window()
        });
    }));


    /* Register Proxy Property With Tweener */

    /* Get Rid of Panel's CSS Background */
    Theming.strip_panel_css();
    /* Initial Coloring */
    Theming.set_panel_color({
        opacity: 0.0
    });
    /* Initial Coloring */
    Transitions.hide_corners({
        opacity: 0.0
    });
    /* Simulate Window Changes */
    _windowUpdated();
}


function disable() {
    /* Disconnect & Null Signals */
    if (Main.screenShield !== null)
        Main.screenShield.disconnect(this._lockScreenSig);

    Main.overview.disconnect(this._overviewShowingSig);
    Main.overview.disconnect(this._overviewHiddenSig);
    global.window_manager.disconnect(this._windowMapSig);
    global.window_manager.disconnect(this._windowDestroySig);
    global.window_manager.disconnect(this._windowMinimizeSig);
    global.window_manager.disconnect(this._windowUnminimizeSig);
    global.window_manager.disconnect(this._maximizeSig);
    global.window_manager.disconnect(this._unmaximizeSig);
    global.screen.disconnect(this._workspaceSwitchSig);
    /* Cleanup Signals */
    this._lockScreenSig = null;
    this._lockScreenShownSig = null;
    this._overviewShowingSig = null;
    this._overviewHiddenSig = null;
    this._windowMapSig = null;
    this._windowDestroySig = null;
    this._windowMinimizeSig = null;
    this._windowUnminimizeSig = null;
    this._maximizeSig = null;
    this._unmaximizeSig = null;
    this._workspaceSwitchSig = null;

    /* Cleanup Settings */
    Settings.unbind_settings();
    Settings.cleanup();

    /* Remove Transparency */
    Transitions.blank_fade_out();
    Transitions.cleanup();

    /* Remove Our Panel Coloring */
    Theming.set_panel_color({
        red: 0,
        green: 0,
        blue: 0,
        opacity: 0
    });
    /* Remove Our Corner Coloring */
    Theming.set_corner_color({
        red: 0,
        green: 0,
        blue: 0,
        opacity: 255
    });
    /* Remove Our Styling */
    Theming.reapply_panel_css();
    Theming.cleanup();

    /* Cleanup Global Variables */
    this.transparent = null;
    this.blank = null;
}

function set_transparent(transparent){
    this.transparent = transparent;
}

function set_blank(blank){
    this.blank = blank;
}


/* Event Handlers */

function _windowUpdated(params = null) {
    if (Main.overview._shown)
        return;
    let workspace = global.screen.get_active_workspace();
    let excluded_window = null;
    if (params !== null) {
        if (!Util.is_undef(params.workspace)) {
            workspace = params.workspace;
        }
        if (!Util.is_undef(params.excluded_window)) {
            excluded_window = params.excluded_window;
        }
    }

    let primary_monitor = global.screen.get_primary_monitor();
    let focused_window = global.display.focus_window;
    let windows = workspace.list_windows();

    let add_transparency = true;

    /* save processing by checking the current window (most likely to be maximized) */
    /* check that the focused window is in the right workspace */
    if (!Util.is_undef(focused_window) && focused_window !== excluded_window && focused_window.maximized_vertically && focused_window.get_monitor() === primary_monitor && focused_window.get_workspace() === workspace && !focused_window.minimized) {
        add_transparency = false;
    } else {
        for (let i = 0; i < windows.length; ++i) {
            let current_window = windows[i];
            if (current_window !== excluded_window && current_window.maximized_vertically && current_window.get_monitor() === primary_monitor && !current_window.minimized) {
                add_transparency = false;
                break;
            }
        }
    }
    let time = (params !== null && !Util.is_undef(params.time)) ? {
        time: params.time
    } : null;
    /* only change if the transparency isn't already correct */
    if (this.transparent !== add_transparency) {
        if (add_transparency) {
            if (params !== null && !Util.is_undef(params.blank) && params.blank) {
                Transitions.blank_fade_out(time);
            } else {
                Transitions.fade_out(time);
            }
        } else {
            Transitions.fade_in(time);

        }
    } else if (this.blank) {
        Transitions.fade_in_from_blank(time);
    }
}

function _workspaceSwitched(wm, from, to, direction) {
    let workspace_to = global.screen.get_workspace_by_index(to);
    if (workspace_to !== null) {
        this._windowUpdated({
            workspace: workspace_to
        });
    } else {
        /* maybe this will do something? */
        this._windowUpdated();
    }
}

function _screenShieldActivated() {
    if (Main.screenShield !== null && !Main.screenShield._isActive) {
        _windowUpdated({
            blank: true,
            time: 0
        });
        Transitions.hide_corners({
            opacity: 0
        });
    } else {
        /* make sure we don't have any odd coloring on the screenShield */
        Transitions.blank_fade_out({
            time: 0
        });
    }

}