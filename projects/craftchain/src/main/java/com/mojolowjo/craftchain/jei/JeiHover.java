package com.mojolowjo.craftchain.jei;

import mezz.jei.api.constants.VanillaTypes;
import mezz.jei.api.ingredients.ITypedIngredient;
import mezz.jei.api.runtime.IJeiRuntime;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;

import java.util.Optional;

/** Finds the ItemStack under the mouse: JEI's ingredient list, bookmarks, recipe screen, or a plain inventory slot. */
public final class JeiHover {

    public static Optional<ItemStack> itemUnderMouse(Screen screen) {
        IJeiRuntime runtime = CraftChainJeiPlugin.runtime();
        if (runtime != null) {
            Optional<ItemStack> fromList = runtime.getIngredientListOverlay().getIngredientUnderMouse()
                    .flatMap(ITypedIngredient::getItemStack);
            if (fromList.isPresent()) {
                return fromList;
            }
            Optional<ItemStack> fromBookmarks = runtime.getBookmarkOverlay().getIngredientUnderMouse()
                    .flatMap(ITypedIngredient::getItemStack);
            if (fromBookmarks.isPresent()) {
                return fromBookmarks;
            }
            Optional<ItemStack> fromRecipes = runtime.getRecipesGui().getIngredientUnderMouse(VanillaTypes.ITEM_STACK);
            if (fromRecipes.isPresent()) {
                return fromRecipes;
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

    /** True while the player is typing into JEI's search box or any focused text field, so letter keys must pass through. */
    public static boolean typingInTextField(Screen screen) {
        IJeiRuntime runtime = CraftChainJeiPlugin.runtime();
        if (runtime != null && runtime.getIngredientListOverlay().hasKeyboardFocus()) {
            return true;
        }
        return screen.getFocused() instanceof EditBox;
    }

    private JeiHover() {}
}
