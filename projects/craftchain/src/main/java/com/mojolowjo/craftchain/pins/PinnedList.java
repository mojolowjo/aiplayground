package com.mojolowjo.craftchain.pins;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojolowjo.craftchain.CraftChain;
import com.mojolowjo.craftchain.planning.CraftPlan;
import com.mojolowjo.craftchain.planning.CraftPlanner;
import com.mojolowjo.craftchain.planning.ItemCounts;
import com.mojolowjo.craftchain.planning.RecipeIndex;
import com.mojolowjo.craftchain.planning.Stock;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;
import net.minecraftforge.fml.loading.FMLPaths;
import net.minecraftforge.registries.ForgeRegistries;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Items the player wants to craft, with a count each, plus what crafting each one would take right
 * now. Every entry is planned against the real stock (inventory plus backpacks), the same plan the
 * G key would run, so the list shows the items that plan takes and the ones it is short of. The
 * two agree by construction: if the list says everything is there, the craft goes ahead.
 * Saved to config/craftchain-pins.json.
 */
public final class PinnedList {
    private static final PinnedList INSTANCE = new PinnedList();
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    public static final class Entry {
        public final Item item;
        public int count;
        /** Items the plan takes from the stock (intermediates you already hold and tools included). */
        public ItemCounts used = new ItemCounts();
        /** Items the plan is short of. */
        public ItemCounts missing = new ItemCounts();
        /** Used or missing item -> the other items that would do instead (tag groups). */
        public Map<Item, Item[]> alternatives = Collections.emptyMap();
        /** True when the full chain can be crafted from the current stock. */
        public boolean craftable;
        /** False when no crafting-table recipe makes the item. */
        public boolean hasRecipe = true;
        /** False before the first plan. */
        public boolean computed;

        /** Everything the plan needs, used and missing together, in plan order. */
        public Map<Item, Integer> needs() {
            Map<Item, Integer> all = new LinkedHashMap<>();
            for (Map.Entry<Item, Integer> e : used.asMap().entrySet()) {
                all.merge(e.getKey(), e.getValue(), Integer::sum);
            }
            for (Map.Entry<Item, Integer> e : missing.asMap().entrySet()) {
                all.merge(e.getKey(), e.getValue(), Integer::sum);
            }
            return all;
        }

        public int needTotal() {
            return used.total() + missing.total();
        }

        Entry(Item item, int count) {
            this.item = item;
            this.count = count;
        }
    }

    private final List<Entry> entries = new ArrayList<>();
    private boolean dirty = true;
    private int lastStockKey;

    public static PinnedList get() {
        return INSTANCE;
    }

    public List<Entry> entries() {
        return entries;
    }

    public void add(Item item, int amount) {
        for (Entry e : entries) {
            if (e.item == item) {
                e.count += amount;
                dirty = true;
                save();
                return;
            }
        }
        entries.add(new Entry(item, amount));
        dirty = true;
        save();
    }

    public boolean remove(Item item) {
        boolean removed = entries.removeIf(e -> e.item == item);
        if (removed) {
            save();
        }
        return removed;
    }

    public void clear() {
        entries.clear();
        save();
    }

    public void invalidate() {
        dirty = true;
    }

    /** Re-plans every entry when the stock changed. Cheap when nothing changed. */
    public void refresh(Stock stock) {
        int key = stock.key();
        if (!dirty && key == lastStockKey) {
            return;
        }
        RecipeIndex index = RecipeIndex.get();
        if (index == null) {
            return;
        }
        lastStockKey = key;
        dirty = false;
        for (Entry e : entries) {
            ItemCounts owned = stock.total().copy();
            owned.take(e.item, Integer.MAX_VALUE); // the pin means "make N new ones"
            CraftPlan plan = new CraftPlanner(index, 3, stock.inventory()).plan(e.item, e.count, owned);
            e.used = plan.used();
            e.missing = plan.missing();
            e.alternatives = plan.alternatives();
            e.hasRecipe = index.isCraftable(e.item);
            e.craftable = e.hasRecipe && plan.missing().isEmpty() && !plan.steps().isEmpty();
            e.computed = true;
        }
    }

    // ---- persistence ---------------------------------------------------------------------

    private static Path file() {
        return FMLPaths.CONFIGDIR.get().resolve("craftchain-pins.json");
    }

    public void load() {
        entries.clear();
        Path f = file();
        if (!Files.exists(f)) {
            return;
        }
        try {
            JsonElement root = JsonParser.parseString(Files.readString(f, StandardCharsets.UTF_8));
            for (JsonElement el : root.getAsJsonArray()) {
                JsonObject o = el.getAsJsonObject();
                ResourceLocation id = ResourceLocation.tryParse(o.get("item").getAsString());
                Item item = id == null ? null : ForgeRegistries.ITEMS.getValue(id);
                if (item == null) {
                    continue;
                }
                entries.add(new Entry(item, Math.max(1, o.get("count").getAsInt())));
            }
        } catch (IOException | RuntimeException ex) {
            CraftChain.LOGGER.warn("Could not read {}: {}", f, ex.toString());
        }
        dirty = true;
    }

    private void save() {
        JsonArray arr = new JsonArray();
        for (Entry e : entries) {
            JsonObject o = new JsonObject();
            ResourceLocation id = ForgeRegistries.ITEMS.getKey(e.item);
            o.addProperty("item", id == null ? "minecraft:air" : id.toString());
            o.addProperty("count", e.count);
            arr.add(o);
        }
        try {
            Files.writeString(file(), GSON.toJson(arr), StandardCharsets.UTF_8);
        } catch (IOException ex) {
            CraftChain.LOGGER.warn("Could not write {}: {}", file(), ex.toString());
        }
    }
}
