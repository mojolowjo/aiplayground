package com.mojolowjo.dataexport;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/** The INDEX.txt lines: one per item, how it is obtained. Pure Java (Gson only), unit tested. */
public final class Index {
    private Index() {}

    /** What one item's line is built from. */
    public static final class Entry {
        public String id;
        public String name;
        /** recipe type id -> how many recipes of that type make this item */
        public final Map<String, Integer> madeBy = new TreeMap<>();
        public int usedIn;
        public final Set<String> droppedBy = new LinkedHashSet<>();
        public boolean isBlock;
        public int tags;
    }

    /** "minecraft:iron_ingot | Iron Ingot | made by: smelting x2, blasting x2 | used in 41 recipes | drops from 3 tables: ... | block: no | tags: 5" */
    public static String line(Entry e) {
        StringBuilder b = new StringBuilder(e.id).append(" | ").append(e.name == null ? "" : e.name);
        if (e.madeBy.isEmpty()) b.append(" | made by: no recipe");
        else {
            b.append(" | made by:");
            boolean first = true;
            for (Map.Entry<String, Integer> t : e.madeBy.entrySet()) {
                b.append(first ? " " : ", ").append(shortType(t.getKey()));
                if (t.getValue() > 1) b.append(" x").append(t.getValue());
                first = false;
            }
        }
        b.append(" | used in ").append(e.usedIn).append(e.usedIn == 1 ? " recipe" : " recipes");
        if (e.droppedBy.isEmpty()) b.append(" | drops from: nothing known");
        else {
            b.append(" | drops from ").append(e.droppedBy.size()).append(e.droppedBy.size() == 1 ? " table: " : " tables: ");
            int n = 0;
            for (String t : e.droppedBy) {
                if (n++ == 6) { b.append(", ..."); break; }
                if (n > 1) b.append(", ");
                b.append(t);
            }
        }
        b.append(" | block: ").append(e.isBlock ? "yes" : "no");
        b.append(" | tags: ").append(e.tags);
        return b.toString();
    }

    /** "minecraft:crafting_shaped" -> "crafting_shaped"; other namespaces keep theirs ("create:mixing"). */
    static String shortType(String typeId) {
        return typeId.startsWith("minecraft:") ? typeId.substring(10) : typeId;
    }

    /** Every item id named by an {@code minecraft:item} entry anywhere in a loot table's JSON. */
    public static Set<String> itemsDroppedBy(JsonElement lootTable) {
        Set<String> out = new LinkedHashSet<>();
        walk(lootTable, out);
        return out;
    }

    private static void walk(JsonElement el, Collection<String> out) {
        if (el == null) return;
        if (el.isJsonObject()) {
            JsonObject o = el.getAsJsonObject();
            JsonElement type = o.get("type");
            JsonElement name = o.get("name");
            if (type != null && name != null && type.isJsonPrimitive() && name.isJsonPrimitive()) {
                String t = type.getAsString();
                if (t.equals("minecraft:item") || t.equals("item")) out.add(withNamespace(name.getAsString()));
            }
            for (Map.Entry<String, JsonElement> kv : o.entrySet()) walk(kv.getValue(), out);
        } else if (el.isJsonArray()) {
            for (JsonElement e : (JsonArray) el) walk(e, out);
        }
    }

    static String withNamespace(String id) {
        return id.indexOf(':') < 0 ? "minecraft:" + id : id;
    }
}
