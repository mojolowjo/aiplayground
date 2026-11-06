package com.mojolowjo.seedscout;

import com.mojang.blaze3d.vertex.DefaultVertexFormat;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.mojang.blaze3d.vertex.VertexFormat;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.renderer.LevelRenderer;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;
import net.minecraftforge.client.event.RenderLevelStageEvent;

import java.util.Map;
import java.util.OptionalDouble;

/**
 * Draws a line box around every cached ore within range, through walls: a lines render type with the depth
 * test off, in AFTER_TRANSLUCENT_BLOCKS. An ore whose block on the client is air or a fluid was mined and
 * is skipped; unloaded client chunks are skipped too.
 */
public final class OreRenderer extends RenderType {
    private OreRenderer(String n, VertexFormat f, VertexFormat.Mode m, int s, boolean a, boolean b, Runnable c, Runnable d) {
        super(n, f, m, s, a, b, c, d);
    }

    /** Vanilla's LINES, with the depth test off and no depth write. */
    public static final RenderType LINES_THROUGH_WALLS = create("seedscout_lines",
            DefaultVertexFormat.POSITION_COLOR_NORMAL, VertexFormat.Mode.LINES, 256, false, false,
            RenderType.CompositeState.builder()
                    .setShaderState(RENDERTYPE_LINES_SHADER)
                    .setLineState(new LineStateShard(OptionalDouble.of(2.0)))
                    .setLayeringState(VIEW_OFFSET_Z_LAYERING)
                    .setTransparencyState(TRANSLUCENT_TRANSPARENCY)
                    .setOutputState(MAIN_TARGET)
                    .setWriteMaskState(COLOR_WRITE)
                    .setDepthTestState(NO_DEPTH_TEST)
                    .setCullState(NO_CULL)
                    .createCompositeState(false));

    private static final int[] PALETTE = {0xFF6B6B, 0xFFD93D, 0x6BCB77, 0x4D96FF, 0xC77DFF, 0xFF9F1C, 0x2EC4B6, 0xF15BB5, 0x9BF6FF, 0xCAFFBF};

    public static void onRenderLevel(RenderLevelStageEvent event) {
        if (event.getStage() != RenderLevelStageEvent.Stage.AFTER_TRANSLUCENT_BLOCKS) return;
        if (!ClientConfig.OVERLAY_ON.get()) return;
        if (ShaderPass.isShadowPass()) return;
        Minecraft mc = Minecraft.getInstance();
        ClientLevel level = mc.level;
        if (level == null || mc.player == null) return;
        String dim = level.dimension().location().toString();
        OreStore store = ScoutLink.store(dim);
        if (store.chunkCount() == 0) return;

        Vec3 cam = event.getCamera().getPosition();
        int range = ClientConfig.RANGE.get();
        int pcx = mc.player.chunkPosition().x, pcz = mc.player.chunkPosition().z;
        Map<String, Integer> colors = ClientConfig.colors();
        java.util.List<String> shown = OreFilter.expand(ClientConfig.shown());
        if (shown.isEmpty()) {
            lastDrawn = 0;
            return;
        }
        float alpha = ClientConfig.OPACITY.get() / 100f;

        PoseStack pose = event.getPoseStack();
        pose.pushPose();
        pose.translate(-cam.x, -cam.y, -cam.z);
        MultiBufferSource.BufferSource buffers = mc.renderBuffers().bufferSource();
        VertexConsumer lines = buffers.getBuffer(LINES_THROUGH_WALLS);
        BlockPos.MutableBlockPos pos = new BlockPos.MutableBlockPos();
        int drawn = 0;
        for (OreStore.ChunkOres chunk : store.snapshot()) {
            if (Math.abs(chunk.x - pcx) > range || Math.abs(chunk.z - pcz) > range) continue;
            if (level.getChunkSource().getChunkNow(chunk.x, chunk.z) == null) continue;
            for (OreStore.Ore ore : chunk.ores) {
                if (!OreFilter.isShown(ore.id(), shown)) continue;
                pos.set(ore.x(), ore.y(), ore.z());
                BlockState here = level.getBlockState(pos);
                if (here.isAir() || !here.getFluidState().isEmpty()) continue;
                int rgb = colorOf(ore.id(), colors);
                float r = ((rgb >> 16) & 255) / 255f, g = ((rgb >> 8) & 255) / 255f, b = (rgb & 255) / 255f;
                LevelRenderer.renderLineBox(pose, lines,
                        ore.x() + 0.02, ore.y() + 0.02, ore.z() + 0.02, ore.x() + 0.98, ore.y() + 0.98, ore.z() + 0.98,
                        r, g, b, alpha);
                drawn++;
            }
        }
        buffers.endBatch(LINES_THROUGH_WALLS);
        pose.popPose();
        lastDrawn = drawn;
    }

    public static volatile int lastDrawn;

    /** The id's color, else its family's, else a palette color by family (so deepslate twins match). */
    public static int colorOf(String id, Map<String, Integer> colors) {
        Integer c = ClientConfig.color(id, colors);
        if (c != null) return c;
        return PALETTE[Math.floorMod(OreFilter.family(id).hashCode(), PALETTE.length)];
    }
}
