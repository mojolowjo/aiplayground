package com.mojolowjo.dataexport;

/** Pure helpers with no Minecraft types, so they can be unit tested. */
public final class Names {
    private Names() {}

    /** A folder name from a world or server name: letters, digits, dot, dash, underscore; never empty. */
    public static String sanitize(String raw) {
        if (raw == null) return "export";
        StringBuilder b = new StringBuilder();
        for (char c : raw.trim().toCharArray()) {
            if (Character.isLetterOrDigit(c) || c == '.' || c == '-' || c == '_') b.append(c);
            else if (c == ' ' || c == ':' || c == '/' || c == '\\') b.append('_');
        }
        while (b.length() > 0 && (b.charAt(0) == '.' || b.charAt(0) == '_')) b.deleteCharAt(0);
        if (b.length() > 64) b.setLength(64);
        return b.length() == 0 ? "export" : b.toString();
    }

    /** "data/minecraft/loot_tables/blocks/stone.json" -> "minecraft:blocks/stone" for the given kind folder, or null. */
    public static String idFromDataPath(String path, String kind) {
        String p = path.replace('\\', '/');
        int data = p.indexOf("data/");
        if (data < 0) return null;
        String rest = p.substring(data + 5);
        int slash = rest.indexOf('/');
        if (slash < 0) return null;
        String ns = rest.substring(0, slash);
        String tail = rest.substring(slash + 1);
        String prefix = kind + "/";
        if (!tail.startsWith(prefix) || !tail.endsWith(".json")) return null;
        return ns + ":" + tail.substring(prefix.length(), tail.length() - 5);
    }
}
