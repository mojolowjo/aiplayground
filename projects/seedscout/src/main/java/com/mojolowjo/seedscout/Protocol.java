package com.mojolowjo.seedscout;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;

/**
 * The JSON-lines protocol between the client and the scout server (one JSON object per line).
 *
 * <pre>
 * client -> {"cmd":"auth","token":"..."}                      server -> {"cmd":"auth","ok":true}
 * client -> {"cmd":"hash"}                                     server -> {"cmd":"hash","hash":L,"seed":L}
 * client -> {"cmd":"scan","dim":"minecraft:overworld","q":Q,
 *            "chunks":[[x,z],...],"blocks":["minecraft:iron_ore","#forge:ores"]}
 *                                                              server -> per chunk {"cmd":"chunk","dim":..,"q":Q,
 *                                                                        "x":x,"z":z,"ores":[[x,y,z,"id"],...]}
 *                                                                        or {...,"error":"text"}
 * client -> {"cmd":"shutdown"}
 * </pre>
 * Pure Java plus Gson, unit tested.
 */
public final class Protocol {
    private Protocol() {}

    /** Signature of a block list: order and duplicates do not matter. */
    public static int query(List<String> blocks) {
        return String.join("\n", new TreeSet<>(blocks)).hashCode();
    }

    public static JsonObject auth(String token) {
        JsonObject o = cmd("auth");
        o.addProperty("token", token);
        return o;
    }

    public static JsonObject hash() {
        return cmd("hash");
    }

    public static JsonObject shutdown() {
        return cmd("shutdown");
    }

    public static JsonObject scan(String dim, int query, List<int[]> chunks, List<String> blocks) {
        JsonObject o = cmd("scan");
        o.addProperty("dim", dim);
        o.addProperty("q", query);
        JsonArray cs = new JsonArray();
        for (int[] c : chunks) {
            JsonArray a = new JsonArray();
            a.add(c[0]);
            a.add(c[1]);
            cs.add(a);
        }
        o.add("chunks", cs);
        JsonArray bs = new JsonArray();
        for (String b : blocks) bs.add(b);
        o.add("blocks", bs);
        return o;
    }

    public static JsonObject chunkReply(String dim, int query, OreStore.ChunkOres c) {
        JsonObject o = cmd("chunk");
        o.addProperty("dim", dim);
        o.addProperty("q", query);
        o.addProperty("x", c.x);
        o.addProperty("z", c.z);
        JsonArray ores = new JsonArray();
        for (OreStore.Ore ore : c.ores) {
            JsonArray a = new JsonArray();
            a.add(ore.x());
            a.add(ore.y());
            a.add(ore.z());
            a.add(ore.id());
            ores.add(a);
        }
        o.add("ores", ores);
        return o;
    }

    public static JsonObject chunkError(String dim, int query, int x, int z, String error) {
        JsonObject o = cmd("chunk");
        o.addProperty("dim", dim);
        o.addProperty("q", query);
        o.addProperty("x", x);
        o.addProperty("z", z);
        o.addProperty("error", error);
        return o;
    }

    public static JsonObject hashReply(long hash, long seed) {
        JsonObject o = cmd("hash");
        o.addProperty("hash", hash);
        o.addProperty("seed", seed);
        return o;
    }

    public static JsonObject error(String text) {
        JsonObject o = cmd("error");
        o.addProperty("error", text);
        return o;
    }

    public static JsonObject parse(String line) {
        return JsonParser.parseString(line).getAsJsonObject();
    }

    public static String command(JsonObject o) {
        JsonElement c = o.get("cmd");
        return c == null ? "" : c.getAsString();
    }

    public static List<int[]> chunks(JsonObject scan) {
        List<int[]> out = new ArrayList<>();
        for (JsonElement e : scan.getAsJsonArray("chunks")) {
            JsonArray a = e.getAsJsonArray();
            out.add(new int[]{a.get(0).getAsInt(), a.get(1).getAsInt()});
        }
        return out;
    }

    public static List<String> strings(JsonObject o, String field) {
        List<String> out = new ArrayList<>();
        JsonElement e = o.get(field);
        if (e != null && e.isJsonArray()) for (JsonElement s : e.getAsJsonArray()) out.add(s.getAsString());
        return out;
    }

    /** The ores of a chunk reply as a ChunkOres; empty when the reply carries an error. */
    public static OreStore.ChunkOres chunkOres(JsonObject reply) {
        int x = reply.get("x").getAsInt(), z = reply.get("z").getAsInt(), q = reply.get("q").getAsInt();
        List<OreStore.Ore> ores = new ArrayList<>();
        JsonElement arr = reply.get("ores");
        if (arr != null && arr.isJsonArray()) {
            for (JsonElement e : arr.getAsJsonArray()) {
                JsonArray a = e.getAsJsonArray();
                ores.add(new OreStore.Ore(a.get(0).getAsInt(), a.get(1).getAsInt(), a.get(2).getAsInt(), a.get(3).getAsString()));
            }
        }
        return new OreStore.ChunkOres(x, z, q, ores);
    }

    private static JsonObject cmd(String name) {
        JsonObject o = new JsonObject();
        o.addProperty("cmd", name);
        return o;
    }
}
