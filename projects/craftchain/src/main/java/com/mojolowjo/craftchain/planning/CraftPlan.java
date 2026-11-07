package com.mojolowjo.craftchain.planning;

import net.minecraft.world.item.Item;
import net.minecraft.world.item.crafting.CraftingRecipe;
import org.jetbrains.annotations.Nullable;

import java.util.List;
import java.util.Map;

/**
 * The output of the planner.
 *
 * @param target       what the player asked for
 * @param requested    how many of it
 * @param steps        crafts to perform, in order (ingredients come before the things that need them)
 * @param missing      raw materials the stock does not cover (item -> count). Empty means the plan is fully doable.
 * @param used         items taken from the stock snapshot (item -> count), tools included once; tells the executor what to fetch from backpacks
 * @param alternatives for each missing or used item, the other items that would have done instead (tag groups), or absent
 * @param needsBigGrid true if at least one recipe needs a 3x3 grid but the plan was made for a 2x2 one
 */
public record CraftPlan(Item target, int requested, List<CraftStep> steps, ItemCounts missing, ItemCounts used,
                        Map<Item, Item[]> alternatives, boolean needsBigGrid) {

    public boolean complete() {
        return missing.isEmpty() && !needsBigGrid;
    }

    public int totalCrafts() {
        int n = 0;
        for (CraftStep s : steps) {
            n += s.times();
        }
        return n;
    }

    /**
     * One crafting recipe, run {@code times} times.
     *
     * @param slotItems for each ingredient index of the recipe, the item the planner picked (null = empty cell)
     * @param reusable  for each ingredient index, true when that item survives the craft (a tool), or null when none does
     */
    public record CraftStep(CraftingRecipe recipe, int times, Item[] slotItems, @Nullable boolean[] reusable) {
        public boolean isReusable(int index) {
            return reusable != null && index < reusable.length && reusable[index];
        }
    }
}
