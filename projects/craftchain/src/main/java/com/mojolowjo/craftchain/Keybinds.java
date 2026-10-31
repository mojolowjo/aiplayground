package com.mojolowjo.craftchain;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.KeyMapping;
import net.minecraftforge.client.event.RegisterKeyMappingsEvent;
import net.minecraftforge.client.settings.KeyConflictContext;
import org.lwjgl.glfw.GLFW;

/**
 * Keys only matter while a screen is open (KeyConflictContext.GUI), so they never clash with
 * movement or other in-world keys. Both are rebindable under Options > Controls > CraftChain.
 */
public final class Keybinds {
    public static final String CATEGORY = "key.categories.craftchain";

    /** Hover an item in JEI (or an inventory slot) and press: craft it. Shift = a full stack. */
    public static final KeyMapping CRAFT = new KeyMapping(
            "key.craftchain.craft", KeyConflictContext.GUI, InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_G, CATEGORY);

    /** Hover an item and press: pin it (+1). Shift = +stack. Ctrl = unpin. */
    public static final KeyMapping PIN = new KeyMapping(
            "key.craftchain.pin", KeyConflictContext.GUI, InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_P, CATEGORY);

    /** Stop a running craft. */
    public static final KeyMapping CANCEL = new KeyMapping(
            "key.craftchain.cancel", KeyConflictContext.GUI, InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_ESCAPE, CATEGORY);

    static void register(RegisterKeyMappingsEvent event) {
        event.register(CRAFT);
        event.register(PIN);
        event.register(CANCEL);
    }

    private Keybinds() {}
}
