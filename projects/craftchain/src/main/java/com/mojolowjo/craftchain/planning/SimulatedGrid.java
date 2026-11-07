package com.mojolowjo.craftchain.planning;

import net.minecraft.core.NonNullList;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.entity.player.StackedContents;
import net.minecraft.world.inventory.CraftingContainer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.CraftingRecipe;
import net.minecraftforge.common.crafting.IShapedRecipe;
import org.jetbrains.annotations.Nullable;

import java.util.List;

/**
 * A crafting grid that exists only in memory, holding one sample item per ingredient slot of a
 * recipe. The index uses it to ask a recipe two things it cannot read from the ingredient list:
 * "would you match this?" (for recipes flagged special, such as TerraFirmaCraft's) and "what do
 * you leave behind?" (tools that are damaged instead of consumed).
 *
 * Grid slot i holds ingredient i: shaped recipes get a grid of exactly their own width and height,
 * shapeless ones a 3x3 filled row by row. That mirrors how the executor lays items out.
 */
final class SimulatedGrid implements CraftingContainer {
    private final int width;
    private final int height;
    private final NonNullList<ItemStack> items;

    private SimulatedGrid(int width, int height, ItemStack[] samples) {
        this.width = width;
        this.height = height;
        this.items = NonNullList.withSize(width * height, ItemStack.EMPTY);
        for (int i = 0; i < samples.length && i < items.size(); i++) {
            items.set(i, samples[i] == null ? ItemStack.EMPTY : samples[i].copy());
        }
    }

    /** Null when the recipe would not fit a 3x3 grid or its shape is inconsistent. */
    @Nullable
    static SimulatedGrid of(CraftingRecipe recipe, ItemStack[] samples) {
        int n = samples.length;
        if (recipe instanceof IShapedRecipe<?> shaped) {
            int w = shaped.getRecipeWidth();
            int h = shaped.getRecipeHeight();
            if (w <= 0 || h <= 0 || w > 3 || h > 3 || w * h != n) {
                return null;
            }
            return new SimulatedGrid(w, h, samples);
        }
        if (n > 9) {
            return null;
        }
        return new SimulatedGrid(3, 3, samples);
    }

    @Override
    public int getWidth() {
        return width;
    }

    @Override
    public int getHeight() {
        return height;
    }

    @Override
    public List<ItemStack> getItems() {
        return items;
    }

    @Override
    public int getContainerSize() {
        return items.size();
    }

    @Override
    public boolean isEmpty() {
        for (ItemStack s : items) {
            if (!s.isEmpty()) {
                return false;
            }
        }
        return true;
    }

    @Override
    public ItemStack getItem(int slot) {
        return slot >= 0 && slot < items.size() ? items.get(slot) : ItemStack.EMPTY;
    }

    @Override
    public ItemStack removeItem(int slot, int amount) {
        return slot >= 0 && slot < items.size() ? items.get(slot).split(amount) : ItemStack.EMPTY;
    }

    @Override
    public ItemStack removeItemNoUpdate(int slot) {
        if (slot < 0 || slot >= items.size()) {
            return ItemStack.EMPTY;
        }
        ItemStack s = items.get(slot);
        items.set(slot, ItemStack.EMPTY);
        return s;
    }

    @Override
    public void setItem(int slot, ItemStack stack) {
        if (slot >= 0 && slot < items.size()) {
            items.set(slot, stack);
        }
    }

    @Override
    public void setChanged() {}

    @Override
    public boolean stillValid(Player player) {
        return true;
    }

    @Override
    public void clearContent() {
        items.clear();
    }

    @Override
    public void fillStackedContents(StackedContents contents) {
        for (ItemStack s : items) {
            contents.accountSimpleStack(s);
        }
    }
}
