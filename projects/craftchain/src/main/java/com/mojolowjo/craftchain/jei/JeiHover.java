package com.mojolowjo.craftchain.jei;

import mezz.jei.api.constants.VanillaTypes;
import mezz.jei.api.ingredients.ITypedIngredient;
import mezz.jei.api.runtime.IJeiRuntime;
import net.minecraft.world.item.ItemStack;

import java.util.Optional;

/**
 * JEI's side of {@link com.mojolowjo.craftchain.ItemHover}: the ingredient list, bookmarks and the
 * recipe screen. Only loaded when a mod called "jei" is present: everything here references JEI's API.
 */
public final class JeiHover {

    public static Optional<ItemStack> itemUnderMouse() {
        IJeiRuntime runtime = CraftChainJeiPlugin.runtime();
        if (runtime == null) {
            return Optional.empty();
        }
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
        return runtime.getRecipesGui().getIngredientUnderMouse(VanillaTypes.ITEM_STACK);
    }

    /** True while JEI's search box has keyboard focus. */
    public static boolean searchFocused() {
        IJeiRuntime runtime = CraftChainJeiPlugin.runtime();
        return runtime != null && runtime.getIngredientListOverlay().hasKeyboardFocus();
    }

    private JeiHover() {}
}
