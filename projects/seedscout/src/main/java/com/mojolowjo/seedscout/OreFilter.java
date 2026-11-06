package com.mojolowjo.seedscout;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * What is drawn, as opposed to what the scout scans. Ores are addressed by a short family name: the block
 * path without {@code deepslate_} and {@code _ore} ("minecraft:deepslate_diamond_ore" and "minecraft:diamond_ore"
 * are both "diamond", "irons_spellbooks:mithril_ore" is "mithril"). Full ids work too. The shown list in the
 * config holds families, ids or preset names; "all" shows everything, an empty list nothing. Pure Java, unit tested.
 */
public final class OreFilter {
    private OreFilter() {}

    public static final String ALL = "all";
    public static final String NONE = "none";

    /** Preset name -> families. "all" and "none" are handled apart. */
    public static final Map<String, List<String>> PRESETS = new LinkedHashMap<>();

    static {
        PRESETS.put("valuables", List.of("diamond", "emerald", "ancient_debris", "mithril", "bismuthinite"));
        PRESETS.put("pack", List.of("mithril", "bismuthinite"));
        PRESETS.put("vanilla", List.of("coal", "iron", "copper", "gold", "redstone", "lapis", "diamond", "emerald",
                "nether_gold", "nether_quartz", "ancient_debris"));
    }

    /** The family of a block id. */
    public static String family(String id) {
        String path = id.contains(":") ? id.substring(id.indexOf(':') + 1) : id;
        if (path.startsWith("deepslate_")) path = path.substring("deepslate_".length());
        if (path.endsWith("_ore")) path = path.substring(0, path.length() - "_ore".length());
        return path;
    }

    /** "diamond, mithril ancient_debris" -> [diamond, mithril, ancient_debris]; lower case, no empties, no repeats. */
    public static List<String> parseList(String text) {
        List<String> out = new ArrayList<>();
        for (String t : text.toLowerCase(Locale.ROOT).split("[,\\s]+")) {
            if (!t.isEmpty() && !out.contains(t)) out.add(t);
        }
        return out;
    }

    /** Presets replaced by their families; "all" and "none" kept as they are. */
    public static List<String> expand(Collection<String> tokens) {
        List<String> out = new ArrayList<>();
        for (String t : tokens) {
            List<String> preset = PRESETS.get(t);
            if (preset != null) {
                for (String f : preset) if (!out.contains(f)) out.add(f);
            } else if (!out.contains(t)) {
                out.add(t);
            }
        }
        if (out.contains(NONE)) return List.of();
        return out;
    }

    public static boolean showsAll(Collection<String> shown) {
        return shown.contains(ALL);
    }

    /** True when the block id is drawn under this shown list (already expanded). */
    public static boolean isShown(String id, Collection<String> shown) {
        if (shown.contains(ALL)) return true;
        return shown.contains(id) || shown.contains(family(id));
    }

    /** The shown list after adding tokens; adding to "all" keeps "all". */
    public static List<String> add(List<String> shown, Collection<String> tokens) {
        List<String> out = new ArrayList<>(expand(shown));
        if (out.contains(ALL)) return out;
        for (String t : expand(tokens)) if (!out.contains(t)) out.add(t);
        return out;
    }

    /** The shown list after removing tokens. Removing from "all" needs the catalog: all families minus the tokens. */
    public static List<String> remove(List<String> shown, Collection<String> tokens, Collection<String> catalogFamilies) {
        List<String> out = new ArrayList<>(expand(shown));
        if (out.contains(ALL)) out = new ArrayList<>(catalogFamilies);
        Set<String> drop = new LinkedHashSet<>(expand(tokens));
        Set<String> dropFamilies = new LinkedHashSet<>();
        for (String d : drop) dropFamilies.add(family(d));
        out.removeIf(t -> drop.contains(t) || dropFamilies.contains(family(t)));
        return out;
    }

    /** Toggle one family in the shown list; the catalog resolves "all". */
    public static List<String> toggle(List<String> shown, String fam, boolean on, Collection<String> catalogFamilies) {
        return on ? add(shown, List.of(fam)) : remove(shown, List.of(fam), catalogFamilies);
    }

    /** Families of a catalog of ids, sorted, each with its ids in the catalog's order. */
    public static Map<String, List<String>> families(Collection<String> ids) {
        Map<String, List<String>> m = new TreeMap<>();
        for (String id : ids) m.computeIfAbsent(family(id), k -> new ArrayList<>()).add(id);
        return m;
    }

    /** Completion candidates for a partial token: presets, families and ids that contain it (prefix matches first). */
    public static List<String> suggest(String partial, Collection<String> families, Collection<String> ids) {
        String p = partial.toLowerCase(Locale.ROOT);
        List<String> prefix = new ArrayList<>(), contains = new ArrayList<>();
        List<String> pool = new ArrayList<>();
        pool.add(ALL);
        pool.add(NONE);
        pool.addAll(PRESETS.keySet());
        pool.addAll(families);
        pool.addAll(ids);
        for (String c : pool) {
            String lc = c.toLowerCase(Locale.ROOT);
            if (lc.startsWith(p)) prefix.add(c);
            else if (lc.contains(p) || (lc.contains(":") && lc.substring(lc.indexOf(':') + 1).startsWith(p))) contains.add(c);
        }
        prefix.addAll(contains);
        return prefix;
    }

    /** Where the token being typed starts in a comma list: after the last comma (and spaces). */
    public static int tokenStart(String text) {
        int comma = text.lastIndexOf(',');
        int i = comma + 1;
        while (i < text.length() && text.charAt(i) == ' ') i++;
        return i;
    }
}
