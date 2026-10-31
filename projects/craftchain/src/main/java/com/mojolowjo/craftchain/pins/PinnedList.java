package com.mojolowjo.craftchain.pins;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojolowjo.craftchain.CraftChain;
import com.mojolowjo.craftchain.planning.CraftPlanner;
import com.mojolowjo.craftchain.planning.ItemCounts;
import com.mojolowjo.craftchain.planning.RecipeIndex;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;
import net.minecraftforge.fml.loading.FMLPaths;
import net.minecraftforge.registries.ForgeRegistries;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Items the player wants to craft, with a count each, plus the raw-material breakdown for each one.
 * Saved to config/craftchain-pins.json so the list survives restarts.
 */
public final class PinnedList {
    private static final PinnedList INSTANCE = new PinnedList();
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    public static final class Entry {
        public final Item item;
        public int count;
        /** Raw materials for {@code count}, recomputed when the count or the recipes change. May be null before the first compute. */
        public ItemCounts raw;

        Entry(Item item, int count) {
            this.item = item;
            this.count = count;
        }
    }

    private final List<Entry> entries = new ArrayList<>();
    private boolean dirty = true;

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
                e.raw = null;
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

    /** Recipes changed (new world, datapack reload): throw away the breakdowns. */
    public void invalidate() {
        for (Entry e : entries) {
            e.raw = null;
        }
        dirty = true;
    }

    /** Fills in missing breakdowns. Cheap when nothing changed. */
    public void refresh() {
        if (!dirty) {
            return;
        }
        RecipeIndex index = RecipeIndex.get();
        if (index == null) {
            return;
        }
        CraftPlanner planner = new CraftPlanner(index, 3);
        for (Entry e : entries) {
            if (e.raw == null) {
                e.raw = planner.rawMaterials(e.item, e.count);
            }
        }
        dirty = false;
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
