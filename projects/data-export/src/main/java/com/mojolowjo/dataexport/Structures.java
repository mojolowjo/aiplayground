package com.mojolowjo.dataexport;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

/** The structure_set summary (structures.json). Pure Java (Gson only), unit tested. */
public final class Structures {
    private Structures() {}

    /**
     * A small summary of one worldgen/structure_set JSON: the placement type as random_spread,
     * concentric_rings or other (with the raw type id), the placement's numbers, and the structure ids
     * in the set. A field the JSON does not carry is left out; a malformed file yields {"note": ...}.
     */
    public static JsonObject summary(JsonElement raw) {
        JsonObject out = new JsonObject();
        if (!(raw instanceof JsonObject set)) {
            out.addProperty("note", "not a JSON object");
            return out;
        }
        JsonElement pl = set.get("placement");
        if (pl instanceof JsonObject p) {
            String type = p.has("type") ? p.get("type").getAsString() : "";
            String kind = switch (type) {
                case "minecraft:random_spread", "random_spread" -> "random_spread";
                case "minecraft:concentric_rings", "concentric_rings" -> "concentric_rings";
                default -> "other";
            };
            out.addProperty("placement", kind);
            if (kind.equals("other")) out.addProperty("placement_type", type);
            copy(p, out, "spacing", "separation", "spread_type", "salt", "frequency", "frequency_reduction_method",
                    "distance", "spread", "count", "preferred_biomes", "locate_offset");
            if (p.has("exclusion_zone")) out.add("exclusion_zone", p.get("exclusion_zone"));
        } else {
            out.addProperty("note", "no placement object");
        }
        JsonArray ids = new JsonArray();
        JsonElement structures = set.get("structures");
        if (structures instanceof JsonArray arr) {
            for (JsonElement e : arr) {
                if (e instanceof JsonObject eo && eo.has("structure")) {
                    JsonElement s = eo.get("structure");
                    ids.add(s.isJsonPrimitive() ? s.getAsString() : "<inline structure>");
                } else if (e.isJsonPrimitive()) {
                    ids.add(e.getAsString());
                }
            }
        }
        out.add("structures", ids);
        return out;
    }

    private static void copy(JsonObject from, JsonObject to, String... keys) {
        for (String k : keys) if (from.has(k)) to.add(k, from.get(k));
    }
}
