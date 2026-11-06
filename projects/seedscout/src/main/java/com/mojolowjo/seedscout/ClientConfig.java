package com.mojolowjo.seedscout;

import net.minecraftforge.common.ForgeConfigSpec;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** config/seedscout-client.toml: seed, ores, colors, range, RAM, auto-start. */
public final class ClientConfig {
    private ClientConfig() {}

    public static final String FILE = "seedscout-client.toml";
    public static final ForgeConfigSpec SPEC;

    public static final ForgeConfigSpec.ConfigValue<String> SEED;
    public static final ForgeConfigSpec.ConfigValue<List<? extends String>> ORES;
    public static final ForgeConfigSpec.ConfigValue<List<? extends String>> COLORS;
    public static final ForgeConfigSpec.IntValue RANGE;
    public static final ForgeConfigSpec.ConfigValue<String> RAM;
    public static final ForgeConfigSpec.BooleanValue AUTO_START;
    public static final ForgeConfigSpec.BooleanValue OVERLAY_ON;
    public static final ForgeConfigSpec.BooleanValue USE_SERVER_PACK;
    public static final ForgeConfigSpec.ConfigValue<List<? extends String>> SHOWN;
    public static final ForgeConfigSpec.IntValue OPACITY;
    public static final ForgeConfigSpec.BooleanValue LEGEND;

    static {
        ForgeConfigSpec.Builder b = new ForgeConfigSpec.Builder();
        b.comment("The real server's world seed. The scout world is generated from it.");
        SEED = b.define("seed", "-3796965907673005514");
        b.comment("Blocks to find: block ids or #tags. Resolved on the scout server, so modded ids work there.");
        ORES = b.defineList("ores", List.of(
                "#forge:ores",
                "irons_spellbooks:mithril_ore", "irons_spellbooks:deepslate_mithril_ore",
                "tinkers_advanced:bismuthinite_ore", "minecraft:ancient_debris"), o -> o instanceof String);
        b.comment("Box colors as id=RRGGBB. Ids without an entry get a color from a fixed palette.");
        COLORS = b.defineList("colors", List.of(
                "minecraft:diamond_ore=4AEDD9", "minecraft:deepslate_diamond_ore=4AEDD9",
                "minecraft:ancient_debris=8B4A2B",
                "minecraft:iron_ore=D8AF93", "minecraft:deepslate_iron_ore=D8AF93",
                "minecraft:gold_ore=FCEE4B", "minecraft:deepslate_gold_ore=FCEE4B",
                "minecraft:emerald_ore=17DD62", "minecraft:deepslate_emerald_ore=17DD62",
                "minecraft:redstone_ore=FF0000", "minecraft:deepslate_redstone_ore=FF0000",
                "minecraft:lapis_ore=1F4BD6", "minecraft:deepslate_lapis_ore=1F4BD6",
                "minecraft:copper_ore=E77C56", "minecraft:deepslate_copper_ore=E77C56",
                "minecraft:coal_ore=333333", "minecraft:deepslate_coal_ore=333333",
                "minecraft:nether_gold_ore=FCEE4B", "minecraft:nether_quartz_ore=EAE6DE",
                "irons_spellbooks:mithril_ore=7FDBFF", "irons_spellbooks:deepslate_mithril_ore=7FDBFF",
                "tinkers_advanced:bismuthinite_ore=C77DFF"), o -> o instanceof String);
        b.comment("Chunks around the player to request and draw (4 = a 9x9 chunk square).");
        RANGE = b.defineInRange("range", 4, 1, 16);
        b.comment("Heap for the scout server, like 5G or 4096M.");
        RAM = b.define("ram", "5G");
        b.comment("Start the scout server when you join a multiplayer server.");
        AUTO_START = b.define("autoStart", false);
        b.comment("Overlay state, kept across restarts (the X key toggles it).");
        OVERLAY_ON = b.define("overlayOn", true);
        b.comment("Setup fetches the pack's official server files from CurseForge (ids from Prism's instance.cfg, else MC Eternal 2 1.3) instead of guessing which client mods to leave out.");
        USE_SERVER_PACK = b.define("useServerPack", true);
        b.comment("What is drawn: families (diamond, mithril), ids, presets (valuables, pack, vanilla) or all. Empty = nothing. /seedscout show, add, remove, or the screen.");
        SHOWN = b.defineList("shown", List.of("all"), o -> o instanceof String);
        b.comment("Box opacity in percent.");
        OPACITY = b.defineInRange("opacity", 90, 10, 100);
        b.comment("Legend in the top right corner: shown ores with their counts within range.");
        LEGEND = b.define("legend", false);
        SPEC = b.build();
    }

    public static List<String> shown() {
        return new ArrayList<>(SHOWN.get());
    }

    public static void setShown(List<String> shown) {
        SHOWN.set(new ArrayList<>(shown));
        SPEC.save();
    }

    /** The color of an ore: its id's entry, else its family's entry, else null. */
    public static Integer color(String id, Map<String, Integer> colors) {
        Integer c = colors.get(id);
        return c != null ? c : colors.get(OreFilter.family(id));
    }

    public static long seed() {
        return Seeds.parse(SEED.get());
    }

    public static List<String> ores() {
        return new ArrayList<>(ORES.get());
    }

    public static void setOres(List<String> ores) {
        ORES.set(new ArrayList<>(ores));
        SPEC.save();
    }

    /** Parsed colors: id -> 0xRRGGBB. */
    public static Map<String, Integer> colors() {
        Map<String, Integer> m = new HashMap<>();
        for (String entry : COLORS.get()) {
            int eq = entry.indexOf('=');
            if (eq <= 0) continue;
            try {
                m.put(entry.substring(0, eq).trim(), Integer.parseInt(entry.substring(eq + 1).trim().replace("#", ""), 16) & 0xFFFFFF);
            } catch (NumberFormatException ignored) {
            }
        }
        return m;
    }

    public static void setColor(String id, int rgb) {
        List<String> out = new ArrayList<>();
        for (String entry : COLORS.get()) if (!entry.startsWith(id + "=")) out.add(entry);
        out.add(id + "=" + String.format("%06X", rgb & 0xFFFFFF));
        COLORS.set(out);
        SPEC.save();
    }
}
