package com.mojolowjo.craftchain.planning;

import com.mojolowjo.craftchain.ClientConfig;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.crafting.CraftingRecipe;
import net.minecraftforge.registries.ForgeRegistries;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Turns "I want N of item X" into an ordered list of crafts, using a stock snapshot (inventory plus
 * backpacks).
 *
 * Depth-first: take what the stock already has, and for the rest pick a recipe, plan each of its
 * ingredients recursively, then append the recipe itself. Ingredients therefore always come before
 * the recipes that consume them.
 *
 * Choosing between items that satisfy one ingredient (a tag such as "any log"):
 * <ol>
 *   <li>the item we hold the most of, inventory first, then backpacks</li>
 *   <li>items the player listed as preferred in the config</li>
 *   <li>never items listed as blocked (unless nothing else exists)</li>
 *   <li>vanilla items before mod items</li>
 *   <li>the recipe's first option</li>
 * </ol>
 *
 * Choosing between recipes: up to {@code maxRecipesPerItem} candidates are tried on a copy of the
 * state and the one leaving the fewest missing raw materials wins, within a work budget.
 *
 * Cycles: an item already being expanded higher up the chain is never expanded again. Reversible
 * pairs (ingot <-> block) are only used when the input is already in stock.
 */
public final class CraftPlanner {
    private final RecipeIndex index;
    private final int gridSize;
    private final int maxDepth;
    private final int maxCandidates;
    private final Set<Item> preferred = new HashSet<>();
    private final Set<Item> blocked = new HashSet<>();
    private final ItemCounts inventoryOnly;
    /** Counts used only to choose between alternatives; usually the stock being planned against. */
    private ItemCounts choiceStock = new ItemCounts();
    private int budget = 20_000;
    private boolean needsBigGrid;
    private Map<Item, Item[]> alternatives;

    /**
     * @param inventoryOnly what is in the player's own inventory (used to prefer those items over
     *                      backpack items); may be the same as the full stock
     */
    public CraftPlanner(RecipeIndex index, int gridSize, ItemCounts inventoryOnly) {
        this.index = index;
        this.gridSize = gridSize;
        this.inventoryOnly = inventoryOnly;
        this.maxDepth = ClientConfig.MAX_PLAN_DEPTH.get();
        this.maxCandidates = ClientConfig.MAX_RECIPES_PER_ITEM.get();
        for (String id : ClientConfig.PREFERRED_ITEMS.get()) {
            Item item = ForgeRegistries.ITEMS.getValue(ResourceLocation.tryParse(id.trim()));
            if (item != null) {
                preferred.add(item);
            }
        }
        for (String id : ClientConfig.BLOCKED_ITEMS.get()) {
            Item item = ForgeRegistries.ITEMS.getValue(ResourceLocation.tryParse(id.trim()));
            if (item != null) {
                blocked.add(item);
            }
        }
    }

    public CraftPlanner(RecipeIndex index, int gridSize) {
        this(index, gridSize, new ItemCounts());
    }

    /** Plan using a stock snapshot. {@code stock} is not modified. */
    public CraftPlan plan(Item target, int count, ItemCounts stock) {
        choiceStock = stock;
        return run(target, count, stock);
    }

    /**
     * The full raw-material list: plans as if nothing were owned, but picks between alternatives
     * ("any log") by what {@code choices} holds, so the list names the log you actually have.
     */
    public CraftPlan planWithChoicesFrom(Item target, int count, ItemCounts choices) {
        choiceStock = choices;
        budget = 20_000;
        return run(target, count, new ItemCounts());
    }

    private CraftPlan run(Item target, int count, ItemCounts stock) {
        ItemCounts inv = stock.copy();
        List<CraftPlan.CraftStep> steps = new ArrayList<>();
        ItemCounts missing = new ItemCounts();
        alternatives = new HashMap<>();
        needsBigGrid = false;
        expand(target, count, new ArrayDeque<>(), inv, steps, missing, 0);
        ItemCounts used = new ItemCounts();
        for (Map.Entry<Item, Integer> e : stock.asMap().entrySet()) {
            int left = inv.get(e.getKey());
            if (left < e.getValue()) {
                used.add(e.getKey(), e.getValue() - left);
            }
        }
        return new CraftPlan(target, count, steps, missing, used, alternatives, needsBigGrid);
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
                    break;
                }
            }
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
            if (alts[i].length > 1) {
                alternatives.putIfAbsent(pick, alts[i]);
            }
        }
        for (Map.Entry<Item, Integer> e : perItem.entrySet()) {
            expand(e.getKey(), e.getValue(), path, inv, steps, missing, depth + 1);
        }
        steps.add(new CraftPlan.CraftStep(recipe, times, chosen));
        inv.add(item, times * perCraft - need);
    }

    private Item pickAlternative(Item[] alts, ItemCounts inv, Deque<Item> path) {
        // 1. most of in the player's own inventory
        Item best = null;
        int bestCount = 0;
        for (Item alt : alts) {
            int have = Math.min(inventoryOnly.get(alt), choiceStock.get(alt));
            if (have > bestCount && !blocked.contains(alt)) {
                best = alt;
                bestCount = have;
            }
        }
        if (best != null) {
            return best;
        }
        // 1b. most of anywhere in stock (backpacks)
        for (Item alt : alts) {
            int have = choiceStock.get(alt);
            if (have > bestCount && !blocked.contains(alt)) {
                best = alt;
                bestCount = have;
            }
        }
        if (best != null) {
            return best;
        }
        // 2. preferred by config
        for (Item alt : alts) {
            if (preferred.contains(alt)) {
                return alt;
            }
        }
        // 3/4. not blocked, craftable, vanilla first
        Item fallback = null;
        for (Item alt : alts) {
            if (blocked.contains(alt)) {
                continue;
            }
            boolean vanilla = isVanilla(alt);
            if (vanilla && !path.contains(alt) && index.isCraftable(alt)) {
                return alt;
            }
            if (fallback == null || (vanilla && !isVanilla(fallback))) {
                fallback = alt;
            }
        }
        return fallback != null ? fallback : alts[0];
    }

    private static boolean isVanilla(Item item) {
        ResourceLocation id = ForgeRegistries.ITEMS.getKey(item);
        return id != null && "minecraft".equals(id.getNamespace());
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
