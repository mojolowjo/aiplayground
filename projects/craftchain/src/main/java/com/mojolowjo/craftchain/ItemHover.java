package com.mojolowjo.craftchain;

import com.mojolowjo.craftchain.emi.EmiHover;
import com.mojolowjo.craftchain.jei.JeiHover;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;
import net.minecraftforge.fml.ModList;

import java.util.Optional;

/**
 * "What is under the mouse?" across the recipe viewers we know. EMI is asked first, then JEI, then
 * the plain container slot. Each viewer's code lives in its own class that is only ever touched when
 * that mod is loaded, so a pack with just one of them (or neither) never loads the other's API.
 *
 * TooManyRecipeViewers registers itself as "jei" on top of EMI; its JEI runtime hands out dummy
 * overlays, so a viewer whose calls throw is switched off after the first failure.
 */
public final class ItemHover {
    private static final boolean EMI = ModList.get().isLoaded("emi");
    private static final boolean JEI = ModList.get().isLoaded("jei");
    private static boolean emiBroken;
    private static boolean jeiBroken;

    public static Optional<ItemStack> itemUnderMouse(Screen screen) {
        if (EMI && !emiBroken) {
            try {
                Optional<ItemStack> hit = EmiHover.itemUnderMouse();
                if (hit.isPresent()) {
                    return hit;
                }
            } catch (Throwable t) {
                emiBroken = true;
                CraftChain.LOGGER.warn("EMI hover lookup failed; EMI support switched off: {}", t.toString());
            }
        }
        if (JEI && !jeiBroken) {
            try {
                Optional<ItemStack> hit = JeiHover.itemUnderMouse();
                if (hit.isPresent()) {
                    return hit;
                }
            } catch (Throwable t) {
                jeiBroken = true;
                CraftChain.LOGGER.warn("JEI hover lookup failed; JEI support switched off: {}", t.toString());
            }
        }
        if (screen instanceof AbstractContainerScreen<?> container) {
            Slot slot = container.getSlotUnderMouse();
            if (slot != null && slot.hasItem()) {
                return Optional.of(slot.getItem());
            }
        }
        return Optional.empty();
    }

    /** True while the player is typing into a viewer's search box or any focused text field, so letter keys must pass through. */
    public static boolean typingInTextField(Screen screen) {
        if (EMI && !emiBroken) {
            try {
                if (EmiHover.searchFocused()) {
                    return true;
                }
            } catch (Throwable t) {
                emiBroken = true;
                CraftChain.LOGGER.warn("EMI focus lookup failed; EMI support switched off: {}", t.toString());
            }
        }
        if (JEI && !jeiBroken) {
            try {
                if (JeiHover.searchFocused()) {
                    return true;
                }
            } catch (Throwable t) {
                jeiBroken = true;
                CraftChain.LOGGER.warn("JEI focus lookup failed; JEI support switched off: {}", t.toString());
            }
        }
        return screen.getFocused() instanceof EditBox;
    }

    public static String describe() {
        return (EMI ? (emiBroken ? "emi(broken)" : "emi") : "") + (EMI && JEI ? "+" : "") + (JEI ? (jeiBroken ? "jei(broken)" : "jei") : "")
                + (!EMI && !JEI ? "none" : "");
    }

    private ItemHover() {}
}
