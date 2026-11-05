package com.mojolowjo.seedscout;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.*;

class ClientOnlyModsTest {
    @Test
    void builtinListCatchesTheUsualClientMods() {
        assertTrue(ClientOnlyMods.matchesBuiltin("XaerosWorldMap_1.38.8_Forge_1.20.jar"));
        assertTrue(ClientOnlyMods.matchesBuiltin("oculus-mc1.20.1-1.7.0.jar"));
        assertTrue(ClientOnlyMods.matchesBuiltin("journeymap-1.20.1-5.9.18-forge.jar"));
        assertTrue(ClientOnlyMods.matchesBuiltin("sound-physics-remastered-forge-1.20.1-1.4.2.jar"));
        assertFalse(ClientOnlyMods.matchesBuiltin("create-1.20.1-0.5.1.f.jar"));
        assertFalse(ClientOnlyMods.matchesBuiltin("irons_spellbooks-1.20.1-3.4.0.jar"));
        assertFalse(ClientOnlyMods.matchesBuiltin("Terralith_1.20.x_v2.5.4.jar"));
        assertFalse(ClientOnlyMods.matchesBuiltin("flywheel-forge-1.20.1-0.6.11.jar"), "Create needs Flywheel on the server");
    }

    @Test
    void modsTomlFlags() {
        String toml = "modLoader=\"javafml\"\nclientSideOnly=true\n[[mods]]\nmodId=\"dataexport\"\n";
        assertTrue(ClientOnlyMods.tomlSaysClientOnly(toml));
        assertFalse(ClientOnlyMods.tomlSaysClientOnly("modLoader=\"javafml\"\n# clientSideOnly=true\n"));
        assertEquals(List.of("dataexport"), ClientOnlyMods.tomlModIds(toml));
        assertEquals(List.of("a", "b"), ClientOnlyMods.tomlModIds("[[mods]]\nmodId=\"a\"\n[[mods]]\n  modId = \"b\"\n"));
    }

    @Test
    void diagnosisReadsForgeCrashReports() {
        String crash = String.join("\n",
                "---- Minecraft Crash Report ----",
                "Description: Mod loading error has occurred",
                "java.lang.Exception: Mod Loading has failed",
                "-- MOD xaerominimap --",
                "Details:",
                "\tMod File: /home/me/server/mods/Xaeros_Minimap_23.9.7_Forge_1.20.jar",
                "\tFailure message: Xaero's Minimap (xaerominimap) has failed to load correctly",
                "\t\tjava.lang.RuntimeException: Attempted to load class net/minecraft/client/gui/screens/Screen for invalid dist DEDICATED_SERVER",
                "\tMod Version: 23.9.7",
                "\tMod Issue URL: NOT PROVIDED",
                "\tException message: java.lang.NoClassDefFoundError: xaero/common/gui/GuiMinimap");
        ClientOnlyMods.Diagnosis d = ClientOnlyMods.diagnose(crash);
        assertEquals(List.of("Xaeros_Minimap_23.9.7_Forge_1.20.jar"), d.jars);
        assertEquals(List.of("xaerominimap"), d.modIds);
        assertEquals(List.of("xaero/common/gui/GuiMinimap"), d.classes, "vanilla client classes are not culprits");
        assertTrue(d.clientClassError);
    }

    @Test
    void diagnosisOfAnUnrelatedLogIsEmpty() {
        ClientOnlyMods.Diagnosis d = ClientOnlyMods.diagnose("[12:00:00] [main/INFO]: Done (3.2s)! For help, type \"help\"");
        assertTrue(d.isEmpty());
        assertFalse(d.clientClassError);
    }

    @Test
    void findsTheJarThatHoldsAClass(@TempDir Path dir) throws Exception {
        Path jar = dir.resolve("somemod-1.0.jar");
        try (ZipOutputStream zip = new ZipOutputStream(new FileOutputStream(jar.toFile()))) {
            zip.putNextEntry(new ZipEntry("META-INF/mods.toml"));
            zip.write("modLoader=\"javafml\"\n[[mods]]\nmodId=\"somemod\"\n".getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
            zip.putNextEntry(new ZipEntry("com/example/some/ClientThing.class"));
            zip.write(new byte[]{(byte) 0xCA, (byte) 0xFE});
            zip.closeEntry();
        }
        assertEquals(jar, ClientOnlyMods.findJarForClass(dir, "com/example/some/ClientThing"));
        assertEquals(jar, ClientOnlyMods.findJarForClass(dir, "com.example.some.ClientThing"));
        assertNull(ClientOnlyMods.findJarForClass(dir, "com/example/other/Thing"));
        assertEquals(List.of("somemod"), ClientOnlyMods.tomlModIds(ClientOnlyMods.readModsToml(jar)));
    }

    @Test
    void exclusionListParsing() {
        Set<String> s = ClientOnlyMods.parseExclusionList("a.jar # failed start 1\n\n  b.jar\n# only a comment\n");
        assertEquals(Set.of("a.jar", "b.jar"), s);
    }
}
