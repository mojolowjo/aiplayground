package com.mojolowjo.dataexport;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.core.RegistryAccess;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.packs.PackType;
import net.minecraft.server.packs.VanillaPackResources;
import net.minecraft.server.packs.repository.ServerPacksSource;
import net.minecraft.world.food.FoodProperties;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Tier;
import net.minecraft.world.item.TieredItem;
import net.minecraft.world.item.crafting.AbstractCookingRecipe;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.Recipe;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraftforge.common.ForgeHooks;
import net.minecraftforge.common.TierSortingRegistry;
import net.minecraftforge.common.ToolAction;
import net.minecraftforge.common.ToolActions;
import net.minecraftforge.common.crafting.IShapedRecipe;
import net.minecraftforge.fml.ModList;
import net.minecraftforge.fml.loading.FMLLoader;
import net.minecraftforge.forgespi.language.IModInfo;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.IForgeRegistry;
import net.minecraftforge.registries.tags.ITag;
import net.minecraftforge.registries.tags.ITagManager;

import java.io.IOException;
import java.io.InputStream;
import java.io.Writer;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystem;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Stream;

/**
 * Writes {@code <game dir>/dataexport/<name>/}. Runs on the client thread (registries and the recipe
 * manager are read there). Every per-entry failure is counted and the first ones go to errors.txt;
 * nothing is skipped silently.
 */
public final class Exporter {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create();
    private static final int MAX_ERRORS_KEPT = 200;
    private static final long MAX_SCRIPT_BYTES = 4L * 1024 * 1024;

    private final Minecraft mc;
    private final Path dir;
    private final RegistryAccess registries;
    private final List<String> errors = new ArrayList<>();
    private int errorCount;
    private final Report report = new Report();

    /** The item index being built while the writers run. */
    private final Map<String, Index.Entry> index = new TreeMap<>();

    public Exporter(Minecraft mc, String folder) {
        this.mc = mc;
        this.dir = mc.gameDirectory.toPath().resolve("dataexport").resolve(folder);
        this.registries = mc.level.registryAccess();
    }

    /** The singleplayer world's name, else the server entry's name (or address). */
    public static String defaultName(Minecraft mc) {
        IntegratedServer single = mc.getSingleplayerServer();
        if (single != null) return single.getWorldData().getLevelName();
        ServerData server = mc.getCurrentServer();
        if (server != null) return server.name != null && !server.name.isBlank() ? server.name : server.ip;
        return "export";
    }

    public static final class Report {
        final Map<String, String> counts = new LinkedHashMap<>();
        Path dir;
        int errors;

        public List<String> lines() {
            List<String> out = new ArrayList<>();
            out.add("dataexport: written to " + dir);
            StringBuilder b = new StringBuilder("dataexport:");
            for (Map.Entry<String, String> e : counts.entrySet()) b.append(' ').append(e.getKey()).append(' ').append(e.getValue()).append(',');
            if (b.charAt(b.length() - 1) == ',') b.setLength(b.length() - 1);
            out.add(b.toString());
            out.add(errors == 0 ? "dataexport: no errors" : "dataexport: " + errors + " entries could not be read, see errors.txt");
            return out;
        }
    }

    public Report run() throws IOException {
        Files.createDirectories(dir);
        long t0 = System.currentTimeMillis();
        for (Item item : ForgeRegistries.ITEMS) {
            String id = String.valueOf(ForgeRegistries.ITEMS.getKey(item));
            Index.Entry e = new Index.Entry();
            e.id = id;
            index.put(id, e);
        }
        writeMeta();
        writeRecipes();
        writeTags();
        writeItems();
        Map<String, JsonElement> loot = new TreeMap<>();
        Map<String, JsonElement> configured = new TreeMap<>();
        Map<String, JsonElement> placed = new TreeMap<>();
        readJarData(loot, configured, placed);
        writeJson("loot.json", loot);
        JsonObject worldgen = new JsonObject();
        worldgen.add("configured_feature", toObject(configured));
        worldgen.add("placed_feature", toObject(placed));
        writeJson("worldgen.json", worldgen);
        report.counts.put("loot tables", String.valueOf(loot.size()));
        report.counts.put("features", configured.size() + "+" + placed.size());
        for (Map.Entry<String, JsonElement> t : loot.entrySet())
            for (String itemId : Index.itemsDroppedBy(t.getValue())) {
                Index.Entry e = index.get(itemId);
                if (e != null) e.droppedBy.add(t.getKey());
            }
        copyKubejs();
        writeIndex();
        writeReadme();
        writeErrors();
        report.dir = dir;
        report.errors = errorCount;
        report.counts.put("seconds", String.valueOf((System.currentTimeMillis() - t0) / 1000));
        return report;
    }

    // ---- meta -------------------------------------------------------------------------------

    private void writeMeta() throws IOException {
        JsonObject o = new JsonObject();
        o.addProperty("minecraft", FMLLoader.versionInfo().mcVersion());
        o.addProperty("forge", FMLLoader.versionInfo().forgeVersion());
        o.addProperty("exported_from", mc.getSingleplayerServer() != null ? "singleplayer world" : "server");
        o.addProperty("world_or_server", defaultName(mc));
        JsonArray mods = new JsonArray();
        for (IModInfo m : ModList.get().getMods()) {
            JsonObject mo = new JsonObject();
            mo.addProperty("id", m.getModId());
            mo.addProperty("name", m.getDisplayName());
            mo.addProperty("version", m.getVersion().toString());
            mods.add(mo);
        }
        o.add("mods", mods);
        writeJson("meta.json", o);
        report.counts.put("mods", String.valueOf(mods.size()));
    }

    // ---- recipes ----------------------------------------------------------------------------

    private void writeRecipes() throws IOException {
        JsonArray out = new JsonArray();
        int n = 0;
        for (Recipe<?> r : mc.level.getRecipeManager().getRecipes()) {
            try {
                out.add(recipeJson(r));
                n++;
            } catch (Throwable t) {
                error("recipe " + safeId(r) + ": " + t);
            }
        }
        writeJson("recipes.json", out);
        report.counts.put("recipes", String.valueOf(n));
    }

    private static String safeId(Recipe<?> r) {
        try { return String.valueOf(r.getId()); } catch (Throwable t) { return r.getClass().getName(); }
    }

    private JsonObject recipeJson(Recipe<?> r) {
        JsonObject o = new JsonObject();
        o.addProperty("id", String.valueOf(r.getId()));
        String type = String.valueOf(ForgeRegistries.RECIPE_TYPES.getKey(r.getType()));
        o.addProperty("type", type);
        ResourceLocation ser = ForgeRegistries.RECIPE_SERIALIZERS.getKey(r.getSerializer());
        if (ser != null && !ser.toString().equals(type)) o.addProperty("serializer", ser.toString());
        String station = station(type);
        if (station != null) o.addProperty("station", station);
        if (r.getGroup() != null && !r.getGroup().isEmpty()) o.addProperty("group", r.getGroup());
        if (r.isSpecial()) o.addProperty("special", true);
        if (r instanceof IShapedRecipe<?> s) {
            o.addProperty("width", s.getRecipeWidth());
            o.addProperty("height", s.getRecipeHeight());
        }
        if (r instanceof AbstractCookingRecipe c) {
            o.addProperty("xp", c.getExperience());
            o.addProperty("ticks", c.getCookingTime());
        }

        // Ingredients: the recipe's own list; when a recipe exposes none (smithing, many modded
        // types) every Ingredient-typed field is read by name instead.
        Set<String> usedItems = new HashSet<>();
        List<Ingredient> ings = r.getIngredients();
        if (ings != null && !ings.isEmpty()) {
            JsonArray arr = new JsonArray();
            for (Ingredient ing : ings) arr.add(ingredientJson(ing, usedItems));
            o.add("ingredients", arr);
        } else {
            JsonObject fields = new JsonObject();
            for (Map.Entry<String, Object> f : fieldsOf(r, Ingredient.class, true).entrySet()) {
                Object v = f.getValue();
                if (v instanceof Ingredient ing) fields.add(f.getKey(), ingredientJson(ing, usedItems));
                else if (v instanceof Collection<?> col) {
                    JsonArray arr = new JsonArray();
                    for (Object x : col) if (x instanceof Ingredient ing) arr.add(ingredientJson(ing, usedItems));
                    fields.add(f.getKey(), arr);
                }
            }
            if (fields.size() > 0) o.add("ingredient_fields", fields);
            else o.addProperty("ingredients_note", "this recipe type exposes no ingredients to the client");
        }

        // Result: the vanilla answer, else every ItemStack-typed field by name.
        ItemStack result = ItemStack.EMPTY;
        try { result = r.getResultItem(registries); } catch (Throwable ignored) { /* modded recipes may refuse */ }
        if (result != null && !result.isEmpty()) {
            o.add("result", stackJson(result));
            madeBy(result, type);
        } else {
            JsonObject outs = new JsonObject();
            for (Map.Entry<String, Object> f : fieldsOf(r, ItemStack.class, true).entrySet()) {
                Object v = f.getValue();
                if (v instanceof ItemStack s && !s.isEmpty()) { outs.add(f.getKey(), stackJson(s)); madeBy(s, type); }
                else if (v instanceof Collection<?> col) {
                    JsonArray arr = new JsonArray();
                    for (Object x : col) if (x instanceof ItemStack s && !s.isEmpty()) { arr.add(stackJson(s)); madeBy(s, type); }
                    if (arr.size() > 0) outs.add(f.getKey(), arr);
                }
            }
            if (outs.size() > 0) o.add("result_fields", outs);
            else o.addProperty("result_note", "no item result readable on the client (fluid, energy or a modded output type)");
        }
        for (String id : usedItems) {
            Index.Entry e = index.get(id);
            if (e != null) e.usedIn++;
        }
        return o;
    }

    private void madeBy(ItemStack s, String type) {
        Index.Entry e = index.get(itemId(s.getItem()));
        if (e != null) e.madeBy.merge(type, 1, Integer::sum);
    }

    /** The vanilla stations by recipe type; modded types say their type instead. */
    static String station(String type) {
        switch (type) {
            case "minecraft:crafting": return "crafting_table";
            case "minecraft:smelting": return "furnace";
            case "minecraft:blasting": return "blast_furnace";
            case "minecraft:smoking": return "smoker";
            case "minecraft:campfire_cooking": return "campfire";
            case "minecraft:stonecutting": return "stonecutter";
            case "minecraft:smithing": return "smithing_table";
            default: return null;
        }
    }

    private JsonElement ingredientJson(Ingredient ing, Set<String> usedItems) {
        JsonElement json = null;
        try { json = ing.toJson(); } catch (Throwable t) { /* fall back to the resolved items */ }
        JsonArray items = new JsonArray();
        try {
            for (ItemStack s : ing.getItems()) {
                String id = itemId(s.getItem());
                items.add(id);
                usedItems.add(id);
            }
        } catch (Throwable t) {
            error("ingredient items: " + t);
        }
        if (json instanceof JsonObject o) {
            if (o.has("tag")) return o;            // tags.json lists the members
            if (o.has("item") && items.size() <= 1) return o;
            o.add("items", items);
            return o;
        }
        if (json instanceof JsonArray a && a.size() == 0) return new JsonObject(); // empty cell
        JsonObject o = new JsonObject();
        if (json != null) o.add("raw", json);
        o.add("items", items);
        return o;
    }

    private static JsonObject stackJson(ItemStack s) {
        JsonObject o = new JsonObject();
        o.addProperty("item", itemId(s.getItem()));
        o.addProperty("count", s.getCount());
        if (s.hasTag()) o.addProperty("nbt", String.valueOf(s.getTag()));
        return o;
    }

    private static String itemId(Item item) {
        return String.valueOf(ForgeRegistries.ITEMS.getKey(item));
    }

    /** Non-static fields of the given type (or collections, when asked) up the class chain, by name. */
    private Map<String, Object> fieldsOf(Object target, Class<?> type, boolean collections) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Class<?> c = target.getClass(); c != null && c != Object.class; c = c.getSuperclass()) {
            for (Field f : c.getDeclaredFields()) {
                if (Modifier.isStatic(f.getModifiers())) continue;
                boolean want = type.isAssignableFrom(f.getType()) || (collections && Collection.class.isAssignableFrom(f.getType()));
                if (!want) continue;
                try {
                    f.setAccessible(true);
                    Object v = f.get(target);
                    if (v == null) continue;
                    if (v instanceof Collection<?> col) {
                        boolean any = false;
                        for (Object x : col) if (type.isInstance(x)) { any = true; break; }
                        if (!any) continue;
                    }
                    out.putIfAbsent(f.getName(), v);
                } catch (Throwable t) {
                    error("field " + c.getSimpleName() + "." + f.getName() + ": " + t);
                }
            }
        }
        return out;
    }

    // ---- tags -------------------------------------------------------------------------------

    private void writeTags() throws IOException {
        JsonObject o = new JsonObject();
        int n = 0;
        n += tagsOf(o, "item", ForgeRegistries.ITEMS, true);
        n += tagsOf(o, "block", ForgeRegistries.BLOCKS, false);
        n += tagsOf(o, "fluid", ForgeRegistries.FLUIDS, false);
        writeJson("tags.json", o);
        report.counts.put("tags", String.valueOf(n));
    }

    private <T> int tagsOf(JsonObject into, String kind, IForgeRegistry<T> reg, boolean countForIndex) {
        ITagManager<T> mgr = reg.tags();
        JsonObject o = new JsonObject();
        int n = 0;
        if (mgr == null) {
            error(kind + " tags: the registry has no tag manager");
            into.add(kind, o);
            return 0;
        }
        for (ITag<T> tag : mgr) {
            try {
                JsonArray members = new JsonArray();
                for (T v : tag) {
                    String id = String.valueOf(reg.getKey(v));
                    members.add(id);
                    if (countForIndex) {
                        Index.Entry e = index.get(id);
                        if (e != null) e.tags++;
                    }
                }
                o.add(tag.getKey().location().toString(), members);
                n++;
            } catch (Throwable t) {
                error(kind + " tag " + tag.getKey().location() + ": " + t);
            }
        }
        into.add(kind, o);
        return n;
    }

    // ---- items ------------------------------------------------------------------------------

    private static final Map<String, ToolAction> TOOL_ACTIONS = new LinkedHashMap<>();
    static {
        TOOL_ACTIONS.put("pickaxe", ToolActions.PICKAXE_DIG);
        TOOL_ACTIONS.put("axe", ToolActions.AXE_DIG);
        TOOL_ACTIONS.put("shovel", ToolActions.SHOVEL_DIG);
        TOOL_ACTIONS.put("hoe", ToolActions.HOE_DIG);
        TOOL_ACTIONS.put("sword", ToolActions.SWORD_DIG);
        TOOL_ACTIONS.put("shears", ToolActions.SHEARS_DIG);
    }

    private void writeItems() throws IOException {
        JsonObject out = new JsonObject();
        int n = 0;
        for (Item item : ForgeRegistries.ITEMS) {
            String id = itemId(item);
            try {
                out.add(id, itemJson(item, id));
                n++;
            } catch (Throwable t) {
                error("item " + id + ": " + t);
            }
        }
        writeJson("items.json", out);
        report.counts.put("items", String.valueOf(n));
    }

    private JsonObject itemJson(Item item, String id) {
        ItemStack stack = new ItemStack(item);
        JsonObject o = new JsonObject();
        String name = stack.getHoverName().getString();
        o.addProperty("name", name);
        Index.Entry e = index.get(id);
        if (e != null) e.name = name;
        o.addProperty("max_stack", stack.getMaxStackSize());
        if (stack.getMaxDamage() > 0) o.addProperty("durability", stack.getMaxDamage());
        o.addProperty("rarity", stack.getRarity().name().toLowerCase());
        int ench = item.getEnchantmentValue(stack);
        if (ench > 0) o.addProperty("enchantability", ench);
        int burn = ForgeHooks.getBurnTime(stack, null);
        if (burn > 0) o.addProperty("fuel_ticks", burn);
        FoodProperties food = stack.getFoodProperties(null);
        if (food != null) {
            JsonObject f = new JsonObject();
            f.addProperty("nutrition", food.getNutrition());
            f.addProperty("saturation", food.getSaturationModifier());
            if (food.isMeat()) f.addProperty("meat", true);
            if (food.canAlwaysEat()) f.addProperty("always_edible", true);
            o.add("food", f);
        }
        if (item instanceof TieredItem t) {
            Tier tier = t.getTier();
            JsonObject tj = new JsonObject();
            ResourceLocation tierName = TierSortingRegistry.getName(tier);
            if (tierName != null) tj.addProperty("tier", tierName.toString());
            tj.addProperty("level", tier.getLevel());
            tj.addProperty("speed", tier.getSpeed());
            tj.addProperty("attack_bonus", tier.getAttackDamageBonus());
            JsonArray kinds = new JsonArray();
            for (Map.Entry<String, ToolAction> a : TOOL_ACTIONS.entrySet())
                if (stack.canPerformAction(a.getValue())) kinds.add(a.getKey());
            tj.add("kinds", kinds);
            o.add("tool", tj);
        }
        if (item instanceof ArmorItem a) {
            JsonObject aj = new JsonObject();
            aj.addProperty("slot", a.getType().getName());
            aj.addProperty("defense", a.getDefense());
            aj.addProperty("toughness", a.getToughness());
            o.add("armor", aj);
        }
        if (item instanceof BlockItem bi) {
            Block block = bi.getBlock();
            JsonObject bj = new JsonObject();
            bj.addProperty("id", String.valueOf(ForgeRegistries.BLOCKS.getKey(block)));
            bj.addProperty("hardness", block.defaultDestroyTime());
            bj.addProperty("blast_resistance", block.getExplosionResistance());
            bj.addProperty("needs_tool", block.defaultBlockState().requiresCorrectToolForDrops());
            o.add("block", bj);
            if (e != null) e.isBlock = true;
        }
        return o;
    }

    // ---- loot and world-gen JSON from the jars, kubejs/data and the world's datapacks -------------

    private void readJarData(Map<String, JsonElement> loot, Map<String, JsonElement> configured, Map<String, JsonElement> placed) {
        int files = 0;
        // 1. vanilla: the game's own data folder (the client jar carries data/ for the integrated server)
        try {
            VanillaPackResources vanilla = ServerPacksSource.createVanillaPackSource();
            for (String kind : new String[]{"loot_tables", "worldgen/configured_feature", "worldgen/placed_feature"}) {
                vanilla.listResources(PackType.SERVER_DATA, "minecraft", kind, (loc, supplier) -> {
                    try (InputStream in = supplier.get()) {
                        take(loot, configured, placed, "data/" + loc.getNamespace() + "/" + loc.getPath(), read(in));
                    } catch (Throwable t) {
                        error("vanilla " + loc + ": " + t);
                    }
                });
            }
            files++;
        } catch (Throwable t) {
            error("vanilla data: " + t);
        }
        // 2. every mod jar's data folder
        for (var info : ModList.get().getModFiles()) {
            String file = String.valueOf(info.getFile().getFileName());
            try {
                Path data = info.getFile().findResource("data");
                if (data == null || !Files.isDirectory(data)) continue;
                files += walkData(data, "jar " + file, loot, configured, placed);
            } catch (Throwable t) {
                error("jar " + file + ": " + t);
            }
        }
        // 3. kubejs/data in the game folder (KubeJS loads it as a datapack, on the client too)
        Path kubeData = mc.gameDirectory.toPath().resolve("kubejs").resolve("data");
        if (Files.isDirectory(kubeData)) {
            try { files += walkData(kubeData, "kubejs/data", loot, configured, placed); }
            catch (Throwable t) { error("kubejs/data: " + t); }
        }
        // 4. a singleplayer world's datapacks folder (folders and zips)
        IntegratedServer single = mc.getSingleplayerServer();
        if (single != null) {
            Path packs = single.getWorldPath(LevelResource.DATAPACK_DIR);
            if (Files.isDirectory(packs)) {
                try (Stream<Path> s = Files.list(packs)) {
                    for (Path p : (Iterable<Path>) s::iterator) {
                        try {
                            if (Files.isDirectory(p)) files += walkData(p.resolve("data"), "datapack " + p.getFileName(), loot, configured, placed);
                            else if (p.toString().endsWith(".zip")) {
                                try (FileSystem fs = FileSystems.newFileSystem(p)) {
                                    files += walkData(fs.getPath("data"), "datapack " + p.getFileName(), loot, configured, placed);
                                }
                            }
                        } catch (Throwable t) {
                            error("datapack " + p.getFileName() + ": " + t);
                        }
                    }
                } catch (IOException e) {
                    error("datapacks folder: " + e);
                }
            }
        }
        report.counts.put("data sources", String.valueOf(files));
    }

    /** Walks one data/ folder; returns 1 when it existed. */
    private int walkData(Path data, String where, Map<String, JsonElement> loot, Map<String, JsonElement> configured, Map<String, JsonElement> placed) throws IOException {
        if (data == null || !Files.isDirectory(data)) return 0;
        try (Stream<Path> s = Files.walk(data)) {
            for (Path p : (Iterable<Path>) s::iterator) {
                if (Files.isDirectory(p) || !p.toString().endsWith(".json")) continue;
                String rel = "data/" + data.relativize(p).toString().replace('\\', '/');
                if (!rel.contains("/loot_tables/") && !rel.contains("/worldgen/configured_feature/") && !rel.contains("/worldgen/placed_feature/")) continue;
                try (InputStream in = Files.newInputStream(p)) {
                    take(loot, configured, placed, rel, read(in));
                } catch (Throwable t) {
                    error(where + " " + rel + ": " + t);
                }
            }
        }
        return 1;
    }

    private static void take(Map<String, JsonElement> loot, Map<String, JsonElement> configured, Map<String, JsonElement> placed, String rel, JsonElement json) {
        String id;
        if ((id = Names.idFromDataPath(rel, "loot_tables")) != null) loot.put(id, json);
        else if ((id = Names.idFromDataPath(rel, "worldgen/configured_feature")) != null) configured.put(id, json);
        else if ((id = Names.idFromDataPath(rel, "worldgen/placed_feature")) != null) placed.put(id, json);
    }

    private static JsonElement read(InputStream in) throws IOException {
        return JsonParser.parseString(new String(in.readAllBytes(), StandardCharsets.UTF_8));
    }

    private static JsonObject toObject(Map<String, JsonElement> m) {
        JsonObject o = new JsonObject();
        for (Map.Entry<String, JsonElement> e : m.entrySet()) o.add(e.getKey(), e.getValue());
        return o;
    }

    // ---- kubejs scripts ---------------------------------------------------------------------

    private void copyKubejs() {
        Path kube = mc.gameDirectory.toPath().resolve("kubejs");
        int n = 0;
        for (String sub : new String[]{"server_scripts", "startup_scripts", "client_scripts"}) {
            Path from = kube.resolve(sub);
            if (!Files.isDirectory(from)) continue;
            try (Stream<Path> s = Files.walk(from)) {
                for (Path p : (Iterable<Path>) s::iterator) {
                    if (Files.isDirectory(p)) continue;
                    try {
                        if (Files.size(p) > MAX_SCRIPT_BYTES) { error("kubejs " + p + ": over 4 MB, skipped"); continue; }
                        Path to = dir.resolve("kubejs").resolve(sub).resolve(from.relativize(p).toString());
                        Files.createDirectories(to.getParent());
                        Files.copy(p, to, StandardCopyOption.REPLACE_EXISTING);
                        n++;
                    } catch (Throwable t) {
                        error("kubejs " + p + ": " + t);
                    }
                }
            } catch (IOException e) {
                error("kubejs/" + sub + ": " + e);
            }
        }
        report.counts.put("kubejs scripts", String.valueOf(n));
    }

    // ---- index, readme, errors --------------------------------------------------------------

    private void writeIndex() throws IOException {
        Path tmp = dir.resolve("INDEX.txt.tmp");
        try (Writer w = Files.newBufferedWriter(tmp, StandardCharsets.UTF_8)) {
            w.write("# One line per item: id | name | how it is made (recipe types, count) | how many recipes use it | loot tables that drop it | is a block | tag count\n");
            w.write("# Details: recipes.json (full recipes), loot.json (full tables), tags.json, items.json, worldgen.json (ore features).\n");
            for (Index.Entry e : index.values()) { w.write(Index.line(e)); w.write('\n'); }
        }
        Files.move(tmp, dir.resolve("INDEX.txt"), StandardCopyOption.REPLACE_EXISTING);
    }

    private void writeReadme() throws IOException {
        String text = String.join("\n",
                "Data Export of a Minecraft modpack (Forge 1.20.1), written by the dataexport client mod.",
                "Read this folder to answer questions like 'how do I get X in this pack?'.",
                "",
                "meta.json      Minecraft and Forge versions, the world or server, every loaded mod (id, name, version).",
                "INDEX.txt      One line per item: how it is made, how often it is used, which loot tables drop it. Start here.",
                "recipes.json   Every recipe the server sent the client, KubeJS edits and removals already applied.",
                "               type = the recipe type (station for vanilla types); ingredients = per slot an {item} or {tag}",
                "               (tag members are in tags.json) or {} for an empty slot; result = {item, count}.",
                "               Recipes whose type hides its ingredients or outputs say so in *_note or list *_fields read by name.",
                "tags.json      item, block and fluid tags with their members, as synced from the server.",
                "items.json     Every item: max stack, durability, food, fuel ticks, tool tier and kinds, armor, block hardness.",
                "loot.json      Loot tables (block drops, mob drops, chest loot) as raw JSON from the pack's jars and datapacks.",
                "               Not synced from the server: a server-only KubeJS loot change is not in here.",
                "worldgen.json  configured_feature and placed_feature JSON (ore veins: which blocks, how many, which heights).",
                "kubejs/        The pack's KubeJS scripts as found in the client's kubejs folder (server_scripts change recipes).",
                "errors.txt     Entries the exporter could not read, if any.",
                "",
                "Ids are namespace:path, e.g. minecraft:iron_ingot. A tag is written #namespace:path or {\"tag\": ...}.",
                "");
        Files.writeString(dir.resolve("README.txt"), text, StandardCharsets.UTF_8);
    }

    private void writeErrors() throws IOException {
        Path f = dir.resolve("errors.txt");
        if (errorCount == 0) { Files.deleteIfExists(f); return; }
        List<String> lines = new ArrayList<>();
        lines.add(errorCount + " entries could not be read" + (errorCount > errors.size() ? "; the first " + errors.size() + ":" : ":"));
        lines.addAll(errors);
        Files.write(f, lines, StandardCharsets.UTF_8);
    }

    private void error(String msg) {
        errorCount++;
        if (errors.size() < MAX_ERRORS_KEPT) errors.add(msg);
        if (errorCount <= 5) DataExport.LOGGER.warn("[dataexport] {}", msg);
    }

    private void writeJson(String name, Object json) throws IOException {
        Path tmp = dir.resolve(name + ".tmp");
        try (Writer w = Files.newBufferedWriter(tmp, StandardCharsets.UTF_8)) {
            GSON.toJson(json, w);
        }
        Files.move(tmp, dir.resolve(name), StandardCopyOption.REPLACE_EXISTING);
    }
}
