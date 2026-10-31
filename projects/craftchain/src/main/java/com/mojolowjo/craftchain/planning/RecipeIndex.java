package com.mojolowjo.craftchain.planning;

import net.minecraft.client.Minecraft;
import net.minecraft.core.RegistryAccess;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.CraftingRecipe;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.RecipeManager;
import net.minecraft.world.item.crafting.RecipeType;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Result item -> crafting recipes that make it, built from the recipe manager the server synced to
 * this client. Only vanilla-style crafting-table recipes are indexed: those are the only ones we
 * can execute by clicking a crafting grid. Smelting, Create pressing, Tinkers casting and so on
 * are left out on purpose, so their outputs count as raw materials.
 */
public final class RecipeIndex {
    private static RecipeIndex current;

    private final Map<Item, List<CraftingRecipe>> byResult = new HashMap<>();
    private final Map<CraftingRecipe, Item[][]> ingredientItems = new HashMap<>();
    private final RegistryAccess registries;

    private RecipeIndex(RecipeManager manager, RegistryAccess registries) {
        this.registries = registries;
        for (CraftingRecipe recipe : manager.getAllRecipesFor(RecipeType.CRAFTING)) {
            if (recipe.isSpecial()) {
                continue; // fireworks, map cloning, armor dye: no fixed ingredients
            }
            ItemStack result = recipe.getResultItem(registries);
            if (result == null || result.isEmpty()) {
                continue;
            }
            List<Ingredient> ingredients = recipe.getIngredients();
            if (ingredients.isEmpty()) {
                continue;
            }
            Item[][] items = new Item[ingredients.size()][];
            boolean usable = true;
            for (int i = 0; i < ingredients.size(); i++) {
                Ingredient ing = ingredients.get(i);
                if (ing.isEmpty()) {
                    items[i] = new Item[0]; // empty grid cell in a shaped recipe
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
            }
            if (!usable) {
                continue;
            }
            ingredientItems.put(recipe, items);
            byResult.computeIfAbsent(result.getItem(), k -> new ArrayList<>()).add(recipe);
        }
    }

    /** Rebuild from the client's recipe manager. Called on RecipesUpdatedEvent, so it is cheap to ask for. */
    public static void rebuild(RecipeManager manager) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null) {
            current = null;
            return;
        }
        current = new RecipeIndex(manager, mc.level.registryAccess());
    }

    public static RecipeIndex get() {
        if (current == null) {
            Minecraft mc = Minecraft.getInstance();
            if (mc.level != null) {
                current = new RecipeIndex(mc.level.getRecipeManager(), mc.level.registryAccess());
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

    public ItemStack result(CraftingRecipe recipe) {
        return recipe.getResultItem(registries);
    }

    public int resultCount(CraftingRecipe recipe) {
        return Math.max(1, result(recipe).getCount());
    }
}
