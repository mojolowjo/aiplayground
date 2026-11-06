package com.mojolowjo.seedscout;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Which jars stay out of the scout server: a built-in name list (minimaps, shaders, render and HUD mods,
 * sound mods, xray mods), jars whose mods.toml says {@code clientSideOnly=true}, and jars a failed start
 * was traced to. The crash diagnosis is text parsing, so it is unit tested without a game.
 */
public final class ClientOnlyMods {
    private ClientOnlyMods() {}

    /** Lower-case fragments of jar file names. Matching jars are never copied to the scout server. */
    public static final List<String> BUILTIN_PATTERNS = List.of(
            // minimaps and world maps
            "xaero", "journeymap", "voxelmap", "minimap", "antique-atlas", "antiqueatlas", "mapatlases",
            // shaders and renderers
            "oculus", "iris", "rubidium", "embeddium", "sodium", "optifine", "shader", "magnesium", "nvidium",
            "entityculling", "entity_culling", "entity-culling", "moreculling", "cullleaves", "cull-leaves",
            "immediatelyfast", "dynamiclights", "dynamic-lights", "dynamic_lights", "lambdynamic", "distanthorizons",
            "farsight", "bobby", "chunkanimator", "physicsmod", "physics-mod", "fallingleaves", "visuality",
            "notenoughanimations", "firstperson", "first-person", "3dskinlayers", "skinlayers3d", "citresewn",
            "cit-resewn", "lightoverlay", "light-overlay", "reblured", "blur-", "particular", "effective",
            // HUD and menu mods
            "betterf3", "fpsreducer", "controlling", "mousetweaks", "mouse-tweaks", "toastcontrol", "toast-control",
            "drippyloadingscreen", "fancymenu", "legendarytooltips", "legendary-tooltips", "itemphysic",
            "bettermodsbutton", "modnametooltip", "catalogue", "configured", "defaultoptions", "default-options",
            "inventoryhud", "inventory-hud", "overloadedarmorbar", "armorchroma", "equipmentcompare",
            "betteradvancements", "clienttweaks", "client-tweaks", "cameraoverhaul", "shoulder", "nofog",
            "chatheads", "chat-heads", "replaymod", "zume", "screenshot", "worldeditcui", "loadmyresources",
            "yeetusexperimentus", "notenoughcrashes", "modernfix-forge-client", "hudcompass", "appleskin-forge-mc1.20.1-client",
            "better-ping", "betterping", "durabilitytooltip", "enchantment-descriptions-client", "itemborders",
            "item-borders", "highlighter", "smoothscroll", "smooth-scroll", "paginatedadvancements",
            // sound mods
            "ambientsounds", "soundphysics", "sound-physics", "sound_physics", "presencefootsteps",
            "extremesoundmuffler", "sound-muffler", "soundmuffler", "auudio", "dynamic-surroundings",
            "dynamicsurroundings", "musictriggers", "music-triggers",
            // xray and cheat clients
            "xray", "x-ray", "freecam"
    );

    private static final Pattern TOML_CLIENT_ONLY = Pattern.compile("(?m)^\\s*clientSideOnly\\s*=\\s*true\\b");
    private static final Pattern TOML_MOD_ID = Pattern.compile("(?m)^\\s*modId\\s*=\\s*\"([^\"]+)\"");

    /**
     * A pattern matches at the start of a word only: "oculus-mc1.20.1" yes, "Vampirism" no ("iris" sits inside
     * a word; the first run on the owner's pack lost Vampirism to that).
     */
    public static boolean matchesBuiltin(String jarName) {
        String n = jarName.toLowerCase(Locale.ROOT);
        for (String p : BUILTIN_PATTERNS) {
            int i = n.indexOf(p);
            while (i >= 0) {
                if (i == 0 || !Character.isLetter(n.charAt(i - 1))) return true;
                i = n.indexOf(p, i + 1);
            }
        }
        return false;
    }

    /** One line of Forge's "Missing or unsupported mandatory dependencies" (or the optional variant). */
    public record DependencyFailure(String modId, String requestedBy, String expected, String actual) {
        public boolean missing() {
            return actual.contains("MISSING");
        }
    }

    private static final Pattern DEPENDENCY = Pattern.compile(
            "Mod ID: '([^']+)', Requested by: '([^']+)', Expected range: '([^']*)', Actual version: '([^']*)'");

    /** The dependency failures a server log lists, in order; empty when it has none. */
    public static List<DependencyFailure> dependencyFailures(String logText) {
        List<DependencyFailure> out = new ArrayList<>();
        Matcher m = DEPENDENCY.matcher(logText);
        while (m.find()) out.add(new DependencyFailure(m.group(1), m.group(2), m.group(3), m.group(4)));
        return out;
    }

    public static boolean tomlSaysClientOnly(String modsToml) {
        return TOML_CLIENT_ONLY.matcher(modsToml).find();
    }

    /** The mod ids declared in a mods.toml text. */
    public static List<String> tomlModIds(String modsToml) {
        List<String> ids = new ArrayList<>();
        Matcher m = TOML_MOD_ID.matcher(modsToml);
        while (m.find()) ids.add(m.group(1));
        return ids;
    }

    /** The META-INF/mods.toml text of a jar, or null when it has none. */
    public static String readModsToml(Path jar) {
        try (ZipFile zip = new ZipFile(jar.toFile())) {
            ZipEntry e = zip.getEntry("META-INF/mods.toml");
            if (e == null) return null;
            try (InputStream in = zip.getInputStream(e)) {
                return new String(in.readAllBytes(), StandardCharsets.UTF_8);
            }
        } catch (IOException ex) {
            return null;
        }
    }

    /** The jar in {@code modsDir} that contains the class (slash or dot form), or null. */
    public static Path findJarForClass(Path modsDir, String className) {
        String entry = className.replace('.', '/');
        if (!entry.endsWith(".class")) entry = entry + ".class";
        try (Stream<Path> jars = Files.list(modsDir)) {
            for (Path jar : (Iterable<Path>) jars::iterator) {
                if (!jar.getFileName().toString().endsWith(".jar")) continue;
                try (ZipFile zip = new ZipFile(jar.toFile())) {
                    if (zip.getEntry(entry) != null) return jar;
                } catch (IOException ignored) {
                    // unreadable jar: skip
                }
            }
        } catch (IOException ignored) {
            // no mods dir
        }
        return null;
    }

    /** What a failed start says about the culprit. */
    public static final class Diagnosis {
        /** Jar file names named in "Mod File:" lines, in order of appearance. */
        public final List<String> jars = new ArrayList<>();
        /** Mod ids named in "Mod ID:" lines or Forge failure messages. */
        public final List<String> modIds = new ArrayList<>();
        /** Classes the server could not load, slash form, vanilla client classes left out. */
        public final List<String> classes = new ArrayList<>();
        /** True when the log holds the dist marker or a client class error at all. */
        public boolean clientClassError;

        public boolean isEmpty() {
            return jars.isEmpty() && modIds.isEmpty() && classes.isEmpty();
        }
    }

    // jar names may hold spaces ("Not Enough Recipe Book-FORGE-0.4.1+1.20.1.jar")
    private static final Pattern MOD_FILE = Pattern.compile("(?m)Mod File:\\s*(?:.*[/\\\\])?([^/\\\\]+?\\.jar)\\s*$");
    private static final Pattern MOD_ID = Pattern.compile("Mod ID:\\s*'([A-Za-z0-9_\\-]+)'");
    // Forge: "Failure message: Xaero's Minimap (xaerominimap) has failed to load correctly"
    private static final Pattern FAILURE_MOD = Pattern.compile("Failure message:[^\\n]*?\\(([a-z][a-z0-9_.\\-]*)\\) has failed");
    private static final Pattern INVALID_DIST = Pattern.compile("Attempted to load class ([\\w/$.]+) for invalid dist DEDICATED_SERVER");
    private static final Pattern NO_CLASS = Pattern.compile("(?:NoClassDefFoundError|ClassNotFoundException):\\s*([\\w/$.]+)");

    /** Parses a server log or crash report. */
    public static Diagnosis diagnose(String logText) {
        Diagnosis d = new Diagnosis();
        Set<String> jars = new LinkedHashSet<>(), ids = new LinkedHashSet<>(), classes = new LinkedHashSet<>();
        Matcher m = MOD_FILE.matcher(logText);
        while (m.find()) jars.add(m.group(1));
        m = MOD_ID.matcher(logText);
        while (m.find()) ids.add(m.group(1));
        m = FAILURE_MOD.matcher(logText);
        while (m.find()) ids.add(m.group(1));
        m = INVALID_DIST.matcher(logText);
        while (m.find()) {
            d.clientClassError = true;
            addClass(classes, m.group(1));
        }
        m = NO_CLASS.matcher(logText);
        while (m.find()) {
            String c = m.group(1);
            if (c.startsWith("net/minecraft/client") || c.startsWith("net.minecraft.client")
                    || c.startsWith("com/mojang/blaze3d") || c.startsWith("com.mojang.blaze3d")
                    || c.startsWith("org/lwjgl") || c.startsWith("org.lwjgl")) d.clientClassError = true;
            addClass(classes, c);
        }
        d.jars.addAll(jars);
        d.modIds.addAll(ids);
        d.classes.addAll(classes);
        return d;
    }

    private static void addClass(Set<String> out, String c) {
        String s = c.replace('.', '/');
        if (s.startsWith("net/minecraft/") || s.startsWith("com/mojang/") || s.startsWith("org/lwjgl/")
                || s.startsWith("java/") || s.startsWith("javax/") || s.startsWith("net/minecraftforge/")) return;
        out.add(s);
    }

    /** One "-- MOD x --" section of a Forge mod-loading crash report. */
    public record CrashSection(String modId, String modFile, String text) {
        /** True when the section is about client code on the server. */
        public boolean clientClassError() {
            return text.contains("invalid dist DEDICATED_SERVER") || text.contains("net/minecraft/client/")
                    || text.contains("net.minecraft.client.") || text.contains("com/mojang/blaze3d")
                    || text.contains("com.mojang.blaze3d") || text.contains("org/lwjgl") || text.contains("org.lwjgl");
        }

        /**
         * Mod jars named in the section's stack frames other than the section's own, Forge's and the JVM's.
         * When one is named, that mod caused the failure (Controllable's class loaded by Framework's config scan).
         */
        public List<String> otherJars() {
            List<String> out = new ArrayList<>();
            Matcher m = FRAME_JAR.matcher(text);
            while (m.find()) {
                String jar = m.group(1);
                if (jar.equals(modFile) || out.contains(jar) || isPlatformJar(jar)) continue;
                out.add(jar);
            }
            return out;
        }
    }

    private static final Pattern SECTION_HEAD = Pattern.compile("(?m)^-- MOD ([^ ]+) --\\s*$");
    private static final Pattern FRAME_JAR = Pattern.compile("~\\[([^\\[\\]%:]+\\.jar)");

    static boolean isPlatformJar(String jar) {
        return jar.startsWith("forge-") || jar.startsWith("fmlcore-") || jar.startsWith("fmlloader-") || jar.startsWith("javafmllanguage-")
                || jar.startsWith("lowcodelanguage-") || jar.startsWith("mclanguage-") || jar.startsWith("modlauncher-")
                || jar.startsWith("securejarhandler-") || jar.startsWith("eventbus-") || jar.startsWith("bootstraplauncher-")
                || jar.startsWith("server-") || jar.startsWith("mixin-") || jar.startsWith("mixinextras-") || jar.startsWith("mixinsquared-")
                || jar.startsWith("asm") || jar.startsWith("coremods-") || jar.startsWith("accesstransformers-")
                || jar.startsWith("fastutil-") || jar.startsWith("gson-") || jar.startsWith("guava-") || jar.startsWith("netty-")
                || jar.startsWith("log4j-") || jar.startsWith("slf4j-") || jar.startsWith("night-config") || jar.startsWith("core-")
                || jar.startsWith("toml-") || jar.startsWith("brigadier-") || jar.startsWith("datafixerupper-") || jar.startsWith("authlib-")
                || jar.startsWith("JarJarFileSystems-") || jar.startsWith("JarJarMetadata-") || jar.startsWith("JarJarSelector-")
                || jar.startsWith("unsafe-") || jar.startsWith("typetools-") || jar.startsWith("jopt-") || jar.startsWith("commons-");
    }

    /** The "-- MOD x --" sections of a crash report, each with its Mod File's jar name (or "" when none). */
    public static List<CrashSection> crashSections(String crashText) {
        List<CrashSection> out = new ArrayList<>();
        Matcher m = SECTION_HEAD.matcher(crashText);
        List<int[]> heads = new ArrayList<>();
        List<String> ids = new ArrayList<>();
        while (m.find()) {
            heads.add(new int[]{m.start(), m.end()});
            ids.add(m.group(1));
        }
        for (int i = 0; i < heads.size(); i++) {
            int from = heads.get(i)[1];
            int to = i + 1 < heads.size() ? heads.get(i + 1)[0] : crashText.length();
            String body = crashText.substring(from, to);
            int sys = body.indexOf("\n-- ");
            if (sys >= 0) body = body.substring(0, sys);
            Matcher f = MOD_FILE.matcher(body);
            out.add(new CrashSection(ids.get(i), f.find() ? f.group(1) : "", body));
        }
        return out;
    }

    /** The saved exclusion list: one jar name per line, text after # ignored. */
    public static Set<String> parseExclusionList(String text) {
        Set<String> out = new LinkedHashSet<>();
        for (String line : text.split("\\R")) {
            int hash = line.indexOf('#');
            String name = (hash >= 0 ? line.substring(0, hash) : line).trim();
            if (!name.isEmpty()) out.add(name);
        }
        return out;
    }
}
