package com.mojolowjo.craftchain.emi;

import dev.emi.emi.api.EmiApi;
import dev.emi.emi.api.stack.EmiIngredient;
import dev.emi.emi.api.stack.EmiStack;
import dev.emi.emi.api.stack.EmiStackInteraction;
import net.minecraft.world.item.ItemStack;

import java.util.Optional;

/**
 * EMI's side of {@link com.mojolowjo.craftchain.ItemHover}. Only loaded when the "emi" mod is
 * present: everything here references EMI's API.
 */
public final class EmiHover {

    /** The item under the mouse in EMI's index, favourites or recipe screen, or in a container slot EMI knows about. */
    public static Optional<ItemStack> itemUnderMouse() {
        EmiStackInteraction hovered = EmiApi.getHoveredStack(true);
        if (hovered == null || hovered.isEmpty()) {
            return Optional.empty();
        }
        EmiIngredient ingredient = hovered.getStack();
        if (ingredient == null) {
            return Optional.empty();
        }
        for (EmiStack stack : ingredient.getEmiStacks()) {
            ItemStack item = stack.getItemStack();
            if (item != null && !item.isEmpty()) {
                return Optional.of(item);
            }
        }
        return Optional.empty();
    }

    public static boolean searchFocused() {
        return EmiApi.isSearchFocused();
    }

    private EmiHover() {}
}
