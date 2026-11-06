package com.mojolowjo.seedscout;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class PackSourceTest {
    @Test
    void prismInstanceCfg() {
        String cfg = String.join("\n", "[General]", "ConfigVersion=1.2", "InstanceType=OneSix", "ManagedPack=true",
                "ManagedPackID=1243287", "ManagedPackName=MC Eternal 2", "ManagedPackType=flame",
                "ManagedPackVersionID=8897052", "ManagedPackVersionName=1.3", "name=MC Eternal 2");
        PackSource.Pack p = PackSource.parseInstanceCfg(cfg);
        assertNotNull(p);
        assertEquals(1243287, p.projectId());
        assertEquals(8897052, p.fileId());
        assertEquals("1.3", p.versionName());
        assertNull(PackSource.parseInstanceCfg("[General]\nname=vanilla\n"), "no managed pack");
        assertNull(PackSource.parseInstanceCfg("ManagedPackType=modrinth\nManagedPackID=abc\nManagedPackVersionID=def\n"), "Modrinth ids are not numbers");
    }

    /** The real answer of CurseForge for MC Eternal 2 1.3 (2026-11-05), shortened. */
    @Test
    void serverPackFromAdditionalFiles() {
        String json = "{\"data\":[{\"id\":8950862,\"displayName\":\"[MCE2]-Server-Pack-1.3.zip\",\"fileLength\":1552953931,"
                + "\"fileName\":\"[MCE2]-Server-Pack-1.3.zip\",\"parentProjectFileId\":8897052,\"projectId\":1243287}]}";
        PackSource.ServerPack sp = PackSource.pickServerPack(json);
        assertNotNull(sp);
        assertEquals(8950862, sp.id());
        assertEquals("[MCE2]-Server-Pack-1.3.zip", sp.fileName());
        assertEquals(1552953931L, sp.length());
        assertNull(PackSource.pickServerPack("{\"data\":[]}"));
        assertNull(PackSource.pickServerPack("{\"data\":[{\"id\":1,\"fileName\":\"resourcepack.zip\"}]}"));
    }

    @Test
    void urls() {
        PackSource.Pack p = new PackSource.Pack(1243287, 8897052, "1.3", "test");
        assertEquals("https://www.curseforge.com/api/v1/mods/1243287/files/8897052/additional-files", PackSource.additionalFilesUrl(p));
        assertEquals("https://www.curseforge.com/api/v1/mods/1243287/files/8950862/download", PackSource.downloadUrl(1243287, 8950862));
    }
}
