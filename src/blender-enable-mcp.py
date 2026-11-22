# Run by VYRON in Blender's background mode:
#   blender.exe -b --python blender-enable-mcp.py -- bl_ext.user_default.mcp
# Turns on what the Blender MCP add-on needs, permanently, in the user's preferences:
#   - Allow Online Access (the add-on refuses to start its server without it)
#   - the MCP add-on itself
#   - the add-on's "Auto Start" option (its server starts whenever Blender opens)
# and saves the preferences. Prints one line VYRON reads: VYRON_RESULT {...}
import json
import sys

import addon_utils  # pylint: disable=import-error
import bpy  # pylint: disable=import-error

result = {"ok": False}
try:
    module = sys.argv[sys.argv.index("--") + 1]
    prefs = bpy.context.preferences
    prefs.system.use_online_access = True
    addon_utils.enable(module, default_set=True, persistent=True)
    addon = prefs.addons.get(module)
    if addon is None:
        raise RuntimeError("The MCP add-on could not be enabled: " + module)
    if addon.preferences is not None and hasattr(addon.preferences, "use_autostart"):
        addon.preferences.use_autostart = True
    bpy.ops.wm.save_userpref()
    result = {
        "ok": True,
        "module": module,
        "online_access": bool(prefs.system.use_online_access),
        "autostart": bool(getattr(addon.preferences, "use_autostart", True)),
        "blender": bpy.app.version_string,
    }
except Exception as ex:  # pylint: disable=broad-exception-caught
    result = {"ok": False, "error": str(ex)}
print("VYRON_RESULT " + json.dumps(result))
sys.stdout.flush()
