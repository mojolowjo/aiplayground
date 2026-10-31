package com.mojolowjo.craftchain.execution;

import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.CraftingMenu;
import net.minecraft.world.inventory.InventoryMenu;
import net.minecraft.world.item.crafting.CraftingRecipe;
import net.minecraftforge.common.crafting.IShapedRecipe;
import org.jetbrains.annotations.Nullable;

/**
 * Where the grid, result and inventory slots live inside a menu. Only the two vanilla menus we can
 * drive are supported:
 *
 * <pre>
 * CraftingMenu  (crafting table): 0 result, 1-9 grid (3x3), 10-36 main inventory, 37-45 hotbar
 * InventoryMenu (player):         0 result, 1-4 grid (2x2), 5-8 armor, 9-35 main, 36-44 hotbar, 45 offhand
 * </pre>
 */
public record GridLayout(int resultSlot, int gridStart, int width, int height, int invStart, int invEnd) {

    @Nullable
    public static GridLayout of(AbstractContainerMenu menu) {
        if (menu instanceof CraftingMenu) {
            return new GridLayout(0, 1, 3, 3, 10, 46);
        }
        if (menu instanceof InventoryMenu) {
            return new GridLayout(0, 1, 2, 2, 9, 45);
        }
        return null;
    }

    public int gridSize() {
        return Math.min(width, height);
    }

    public int gridSlot(int row, int col) {
        return gridStart + row * width + col;
    }

    public int gridSlotCount() {
        return width * height;
    }

    /**
     * Maps each ingredient index of the recipe to a menu slot. Shaped recipes keep their shape,
     * anchored at the top-left; shapeless ones fill the grid row by row. Returns null when the
     * recipe does not fit.
     */
    @Nullable
    public int[] slotsFor(CraftingRecipe recipe) {
        int n = recipe.getIngredients().size();
        int[] slots = new int[n];
        if (recipe instanceof IShapedRecipe<?> shaped) {
            int w = shaped.getRecipeWidth();
            int h = shaped.getRecipeHeight();
            if (w > width || h > height || w * h != n) {
                return null;
            }
            for (int i = 0; i < n; i++) {
                slots[i] = gridSlot(i / w, i % w);
            }
            return slots;
        }
        if (n > gridSlotCount()) {
            return null;
        }
        for (int i = 0; i < n; i++) {
            slots[i] = gridStart + i;
        }
        return slots;
    }
}
