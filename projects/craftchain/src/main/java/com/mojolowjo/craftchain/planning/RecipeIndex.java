package com.mojolowjo.craftchain.planning;

import com.mojolowjo.craftchain.CraftChain;
import net.minecraft.client.Minecraft;
import net.minecraft.core.NonNullList;
import net.minecraft.core.RegistryAccess;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.CraftingRecipe;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.RecipeManager;
import net.minecraft.world.item.crafting.RecipeType;
import net.minecraft.world.level.Level;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;

/**
 * Result item -> crafting recipes that make it, built from the recipe manager the server synced to
 * this client. Only vanilla-style crafting-table recipes are indexed: those are the only ones we
 * can execute by clicking a crafting grid. Smelting, Create pressing, Tinkers casting and so on
 * are left out on purpose, so their outputs count as raw materials.
 *
 * Two things are probed with a {@link SimulatedGrid} holding one sample item per slot:
 * <ul>
 *   <li>Recipes flagged "special" are kept if they still match that grid. Vanilla uses the flag for
 *       fireworks and map cloning (no fixed ingredients; they do not match), TerraFirmaCraft uses
 *       it for ordinary shaped recipes whose output copies something from the input.</li>
 *   <li>Slots whose item comes back from {@code getRemainingItems} are "reusable": tools that are
 *       damaged rather than consumed (TerraFirmaCraft hammers and saws, GregTech tools, anything
 *       with a crafting remainder of itself). The planner needs one of those, not one per craft.</li>
 * </ul>
 */
public final class RecipeIndex {
    private static RecipeIndex current;

    private final Map<Item, List<CraftingRecipe>> byResult = new HashMap<>();
    private final Map<CraftingRecipe, Item[][]> ingredientItems = new HashMap<>();
    /** Recipes with at least one reusable slot -> flag per ingredient index. Absent = nothing reusable. */
    private final Map<CraftingRecipe, boolean[]> reusableSlots = new HashMap<>();
    /** Keyed by the identity of each alternatives array: "#minecraft:logs" style label, or null for a single item. */
    private final Map<Item[], String> groupLabels = new IdentityHashMap<>();
    private final RegistryAccess registries;

    private RecipeIndex(RecipeManager manager, Level level) {
        this.registries = level.registryAccess();
        int special = 0;
        int specialKept = 0;
        int reusable = 0;
        int probeFailures = 0;
        for (CraftingRecipe recipe : manager.getAllRecipesFor(RecipeType.CRAFTING)) {
            ItemStack result;
            List<Ingredient> ingredients;
            try {
                result = recipe.getResultItem(registries);
                ingredients = recipe.getIngredients();
            } catch (RuntimeException ex) {
                probeFailures++;
                continue;
            }
            if (result == null || result.isEmpty() || ingredients.isEmpty()) {
                continue;
            }
            Item[][] items = new Item[ingredients.size()][];
            ItemStack[] samples = new ItemStack[ingredients.size()];
            boolean usable = true;
            for (int i = 0; i < ingredients.size(); i++) {
                Ingredient ing = ingredients.get(i);
                if (ing.isEmpty()) {
                    items[i] = new Item[0]; // empty grid cell in a shaped recipe
                    samples[i] = ItemStack.EMPTY;
                    continue;
                }
                ItemStack[] stacks = ing.getItems();
                if (stacks.length == 0) {
                    usable = false; // tag with nothing in it
                    break;
                }
                Item[] alts = new Item[stacks.length];
                for (int j = 0; j < stacks.length; j++) {
                    alts[j] = stacks[j].getItem();
                }
                items[i] = alts;
                samples[i] = stacks[0];
                if (alts.length > 1) {
                    groupLabels.put(alts, labelFor(ing, alts.length));
                }
            }
            if (!usable) {
                continue;
            }
            SimulatedGrid grid = SimulatedGrid.of(recipe, samples);
            if (recipe.isSpecial()) {
                special++;
                if (grid == null || !matches(recipe, grid, level)) {
                    continue; // fireworks, map cloning, armor dye: no fixed ingredients
                }
                specialKept++;
            }
            boolean[] flags = grid == null ? null : reusableFlags(recipe, grid, samples);
            if (flags != null) {
                reusableSlots.put(recipe, flags);
                reusable++;
            }
            ingredientItems.put(recipe, items);
            byResult.computeIfAbsent(result.getItem(), k -> new ArrayList<>()).add(recipe);
        }
        CraftChain.LOGGER.info("Indexed {} crafting recipes for {} items ({} of {} special recipes kept, {} with reusable tools, {} probes failed)",
                ingredientItems.size(), byResult.size(), specialKept, special, reusable, probeFailures + remainingFailures);
    }

    private int remainingFailures;

    private static boolean matches(CraftingRecipe recipe, SimulatedGrid grid, Level level) {
        try {
            return recipe.matches(grid, level);
        } catch (RuntimeException ex) {
            return false;
        }
    }

    /** Flags per ingredient index, or null when nothing in the grid survives a craft. */
    private boolean[] reusableFlags(CraftingRecipe recipe, SimulatedGrid grid, ItemStack[] samples) {
        NonNullList<ItemStack> remaining;
        try {
            remaining = recipe.getRemainingItems(grid);
        } catch (RuntimeException ex) {
            remainingFailures++;
            return null;
        }
        if (remaining == null) {
            return null;
        }
        boolean[] flags = new boolean[samples.length];
        boolean any = false;
        for (int i = 0; i < samples.length && i < remaining.size(); i++) {
            ItemStack left = remaining.get(i);
            if (!samples[i].isEmpty() && left != null && !left.isEmpty() && left.getItem() == samples[i].getItem()) {
                flags[i] = true;
                any = true;
            }
        }
        return any ? flags : null;
    }

    /** "#minecraft:logs" for a tag ingredient, otherwise "any of N". */
    private static String labelFor(Ingredient ing, int count) {
        try {
            JsonElement json = ing.toJson();
            if (json instanceof JsonObject o && o.has("tag")) {
                return "#" + o.get("tag").getAsString();
            }
        } catch (RuntimeException ignored) {
            // some modded ingredients cannot serialise; fall through
        }
        return "any of " + count;
    }

    /** The group label for an alternatives array handed out by {@link #ingredientItems}, or null for a single item. */
    public String groupLabel(Item[] alternatives) {
        return groupLabels.get(alternatives);
    }

    /** Rebuild from the client's recipe manager. Called on RecipesUpdatedEvent, so it is cheap to ask for. */
    public static void rebuild(RecipeManager manager) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null) {
            current = null;
            return;
        }
        current = new RecipeIndex(manager, mc.level);
    }

    public static RecipeIndex get() {
        if (current == null) {
            Minecraft mc = Minecraft.getInstance();
            if (mc.level != null) {
                current = new RecipeIndex(mc.level.getRecipeManager(), mc.level);
            }
        }
        return current;
    }

    public static void clear() {
        current = null;
    }

    public List<CraftingRecipe> recipesFor(Item item) {
        return byResult.getOrDefault(item, Collections.emptyList());
    }

    public boolean isCraftable(Item item) {
        return byResult.containsKey(item);
    }

    /** For each ingredient slot of the recipe, the items that satisfy it. Empty array = empty cell. */
    public Item[][] ingredientItems(CraftingRecipe recipe) {
        return ingredientItems.get(recipe);
    }

    /** Per ingredient slot, true when the item stays in the grid after a craft (a tool). Null when nothing does. */
    public boolean[] reusableSlots(CraftingRecipe recipe) {
        return reusableSlots.get(recipe);
    }

    public ItemStack result(CraftingRecipe recipe) {
        return recipe.getResultItem(registries);
    }

    public int resultCount(CraftingRecipe recipe) {
        return Math.max(1, result(recipe).getCount());
    }
}
