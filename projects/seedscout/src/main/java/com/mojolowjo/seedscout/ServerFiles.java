package com.mojolowjo.seedscout;

import java.util.Locale;
import java.util.regex.Pattern;

/** Text of the scout server's files and the lines we look for in its log. Pure Java, unit tested. */
public final class ServerFiles {
    private ServerFiles() {}

    public static final String MC_VERSION = "1.20.1";
    public static final String FORGE_VERSION = "47.4.2";
    public static final String INSTALLER_NAME = "forge-" + MC_VERSION + "-" + FORGE_VERSION + "-installer.jar";
    public static final String INSTALLER_URL = "https://maven.minecraftforge.net/net/minecraftforge/forge/"
            + MC_VERSION + "-" + FORGE_VERSION + "/" + INSTALLER_NAME;
    public static final String EULA_URL = "https://aka.ms/MinecraftEULA";
    /** Written by the scout mod in the server folder once its socket listens; the client reads port and token there. */
    public static final String ENDPOINT_FILE = "seedscout-endpoint.json";
    public static final String EXCLUDED_FILE = "excluded-mods.txt";

    /** The installer's argument file, relative to the server folder. */
    public static String argsFile(boolean windows) {
        return "libraries/net/minecraftforge/forge/" + MC_VERSION + "-" + FORGE_VERSION + "/"
                + (windows ? "win_args.txt" : "unix_args.txt");
    }

    public static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
    }

    public static String serverProperties(long seed, int port) {
        return String.join("\n",
                "# Written by seedscout. The scout world: same seed as the real server, nobody plays here.",
                "level-seed=" + seed,
                "level-name=world",
                "server-ip=127.0.0.1",
                "server-port=" + port,
                "online-mode=false",
                "view-distance=3",
                "simulation-distance=2",
                "max-players=1",
                "enable-rcon=false",
                "enable-query=false",
                "enable-status=false",
                "spawn-protection=0",
                "max-tick-time=-1",
                "sync-chunk-writes=false",
                "spawn-monsters=false",
                "spawn-animals=false",
                "spawn-npcs=false",
                "generate-structures=true",
                "allow-nether=true",
                "difficulty=peaceful",
                "gamemode=spectator",
                "motd=seedscout",
                "") ;
    }

    /** Replaces or adds {@code key=value} in a properties text. */
    public static String withProperty(String properties, String key, String value) {
        Pattern p = Pattern.compile("(?m)^" + Pattern.quote(key) + "\\s*=.*$");
        if (p.matcher(properties).find()) return p.matcher(properties).replaceFirst(key + "=" + value);
        return properties + (properties.endsWith("\n") || properties.isEmpty() ? "" : "\n") + key + "=" + value + "\n";
    }

    public static String eula() {
        return "# Accepted from inside the game with /seedscout setup accept-eula (" + EULA_URL + ")\neula=true\n";
    }

    private static final Pattern DONE = Pattern.compile("\\]: Done \\([\\d.,]+s\\)!");

    /** The dedicated server's "Done (12.345s)! For help, type \"help\"" line. */
    public static boolean isDoneLine(String line) {
        return DONE.matcher(line).find();
    }

    /** "5G", "4096M", "5g" -> a -Xmx argument; anything else -> the default. */
    public static String xmx(String ram, String fallback) {
        String r = ram == null ? "" : ram.trim().toUpperCase(Locale.ROOT);
        if (r.matches("\\d+[GM]")) return "-Xmx" + r;
        return "-Xmx" + fallback;
    }
}
