package com.mojolowjo.craftchain.planning;

import com.mojolowjo.craftchain.ClientConfig;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.crafting.CraftingRecipe;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Turns "I want N of item X" into an ordered list of crafts, using what is in a (virtual) inventory.
 *
 * The algorithm is depth-first: take what the inventory already has, and for the rest pick a recipe,
 * plan each of its ingredients recursively, then append the recipe itself. Ingredients therefore
 * always come before the recipes that consume them.
 *
 * Choosing between recipes: up to {@code maxRecipesPerItem} candidates are each tried on a copy of
 * the state and the one leaving the fewest missing raw materials wins. A work budget keeps that
 * from exploding on packs with hundreds of alternative recipes; past the budget the planner goes
 * greedy (first candidate only).
 *
 * Cycles: an item already being expanded higher up the chain is never expanded again (iron ingot ->
 * iron block -> iron ingot). On top of that, "reversible" recipes (ingot <-> block, ingot <-> nugget)
 * are only used when the inventory already holds enough of the input, so the planner never invents
 * blocks from ingots it does not have, and the raw-material breakdown stops at the ingot.
 */
public final class CraftPlanner {
    private final RecipeIndex index;
    private final int gridSize;
    private final int maxDepth;
    private final int maxCandidates;
    private int budget = 20_000;
    private boolean needsBigGrid;

    public CraftPlanner(RecipeIndex index, int gridSize) {
        this.index = index;
        this.gridSize = gridSize;
        this.maxDepth = ClientConfig.MAX_PLAN_DEPTH.get();
        this.maxCandidates = ClientConfig.MAX_RECIPES_PER_ITEM.get();
    }

    /** Plan using an inventory. {@code inventory} is not modified. */
    public CraftPlan plan(Item target, int count, ItemCounts inventory) {
        ItemCounts inv = inventory.copy();
        List<CraftPlan.CraftStep> steps = new ArrayList<>();
        ItemCounts missing = new ItemCounts();
        needsBigGrid = false;
        expand(target, count, new ArrayDeque<>(), inv, steps, missing, 0);
        return new CraftPlan(target, count, steps, missing, needsBigGrid);
    }

    /** The full raw-material breakdown of N items, as if the inventory were empty. */
    public ItemCounts rawMaterials(Item target, int count) {
        return plan(target, count, new ItemCounts()).missing();
    }

    private void expand(Item item, int need, Deque<Item> path, ItemCounts inv,
                        List<CraftPlan.CraftStep> steps, ItemCounts missing, int depth) {
        need -= inv.take(item, need);
        if (need <= 0) {
            return;
        }
        if (depth >= maxDepth || path.contains(item)) {
            missing.add(item, need);
            return;
        }
        List<CraftingRecipe> candidates = candidates(item, need, path, inv);
        if (candidates.isEmpty()) {
            missing.add(item, need);
            return;
        }

        path.push(item);
        try {
            if (candidates.size() == 1 || budget <= 0) {
                apply(candidates.get(0), item, need, path, inv, steps, missing, depth);
                return;
            }
            // Try each candidate on a copy; keep the one that leaves the least missing.
            Best best = null;
            for (CraftingRecipe recipe : candidates) {
                budget--;
                ItemCounts invCopy = inv.copy();
                List<CraftPlan.CraftStep> stepsCopy = new ArrayList<>();
                ItemCounts missingCopy = new ItemCounts();
                boolean bigBefore = needsBigGrid;
                apply(recipe, item, need, path, invCopy, stepsCopy, missingCopy, depth);
                Best b = new Best(invCopy, stepsCopy, missingCopy, needsBigGrid);
                needsBigGrid = bigBefore;
                if (best == null || b.betterThan(best)) {
                    best = b;
                }
                if (missingCopy.isEmpty()) {
                    break; // can't beat zero missing
                }
            }
            // Commit the winner.
            inv.asMap().clear();
            inv.asMap().putAll(best.inv.asMap());
            steps.addAll(best.steps);
            for (Map.Entry<Item, Integer> e : best.missing.asMap().entrySet()) {
                missing.add(e.getKey(), e.getValue());
            }
            needsBigGrid = best.bigGrid;
        } finally {
            path.pop();
        }
    }

    private record Best(ItemCounts inv, List<CraftPlan.CraftStep> steps, ItemCounts missing, boolean bigGrid) {
        boolean betterThan(Best other) {
            int a = missing.total();
            int b = other.missing.total();
            if (a != b) {
                return a < b;
            }
            if (bigGrid != other.bigGrid) {
                return !bigGrid;
            }
            return steps.size() < other.steps.size();
        }
    }

    /** Runs one recipe enough times to cover {@code need}, planning its ingredients first. */
    private void apply(CraftingRecipe recipe, Item item, int need, Deque<Item> path, ItemCounts inv,
                       List<CraftPlan.CraftStep> steps, ItemCounts missing, int depth) {
        int perCraft = index.resultCount(recipe);
        int times = (need + perCraft - 1) / perCraft;
        Item[][] alts = index.ingredientItems(recipe);
        Item[] chosen = new Item[alts.length];
        Map<Item, Integer> perItem = new LinkedHashMap<>();
        for (int i = 0; i < alts.length; i++) {
            if (alts[i].length == 0) {
                continue;
            }
            Item pick = pickAlternative(alts[i], inv, path);
            chosen[i] = pick;
            perItem.merge(pick, times, Integer::sum);
        }
        for (Map.Entry<Item, Integer> e : perItem.entrySet()) {
            expand(e.getKey(), e.getValue(), path, inv, steps, missing, depth + 1);
        }
        steps.add(new CraftPlan.CraftStep(recipe, times, chosen));
        inv.add(item, times * perCraft - need); // leftovers stay available for later steps
    }

    /** Prefer what we hold the most of; then something craftable; then the recipe's first option. */
    private Item pickAlternative(Item[] alts, ItemCounts inv, Deque<Item> path) {
        Item best = null;
        int bestCount = 0;
        for (Item alt : alts) {
            int have = inv.get(alt);
            if (have > bestCount) {
                best = alt;
                bestCount = have;
            }
        }
        if (best != null) {
            return best;
        }
        for (Item alt : alts) {
            if (!path.contains(alt) && index.isCraftable(alt)) {
                return alt;
            }
        }
        return alts[0];
    }

    private List<CraftingRecipe> candidates(Item item, int need, Deque<Item> path, ItemCounts inv) {
        List<CraftingRecipe> out = new ArrayList<>();
        for (CraftingRecipe recipe : index.recipesFor(item)) {
            if (!recipe.canCraftInDimensions(gridSize, gridSize)) {
                if (recipe.canCraftInDimensions(3, 3)) {
                    needsBigGrid = true;
                }
                continue;
            }
            if (isReversible(recipe, item) && !inputsOnHand(recipe, need, inv)) {
                continue;
            }
            out.add(recipe);
            if (out.size() >= maxCandidates) {
                break;
            }
        }
        return out;
    }

    /**
     * True for compression pairs: the recipe's only input Y itself has a recipe whose only input is
     * {@code item} (ingot -> block -> ingot, ingot -> nugget -> ingot).
     */
    private boolean isReversible(CraftingRecipe recipe, Item item) {
        Item only = singleInput(recipe);
        if (only == null) {
            return false;
        }
        for (CraftingRecipe back : index.recipesFor(only)) {
            if (singleInput(back) == item) {
                return true;
            }
        }
        return false;
    }

    /** The single distinct ingredient item of a recipe, or null when it has more than one (or alternatives). */
    private Item singleInput(CraftingRecipe recipe) {
        Item[][] alts = index.ingredientItems(recipe);
        Item only = null;
        for (Item[] slot : alts) {
            if (slot.length == 0) {
                continue;
            }
            if (slot.length != 1) {
                return null;
            }
            if (only == null) {
                only = slot[0];
            } else if (only != slot[0]) {
                return null;
            }
        }
        return only;
    }

    private boolean inputsOnHand(CraftingRecipe recipe, int need, ItemCounts inv) {
        int perCraft = index.resultCount(recipe);
        int times = (need + perCraft - 1) / perCraft;
        Map<Item, Integer> required = new LinkedHashMap<>();
        for (Item[] slot : index.ingredientItems(recipe)) {
            if (slot.length > 0) {
                required.merge(slot[0], times, Integer::sum);
            }
        }
        for (Map.Entry<Item, Integer> e : required.entrySet()) {
            if (inv.get(e.getKey()) < e.getValue()) {
                return false;
            }
        }
        return true;
    }
}
