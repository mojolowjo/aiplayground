package com.mojolowjo.seedscout;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.AbstractSliderButton;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.Checkbox;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The ore filter screen: a searchable list of ore families, each with a checkbox, a color swatch and the count
 * cached within range; presets, range and opacity sliders, the legend toggle and the scout status. Every change
 * is saved to the config at once. Opened from the pause screen, the inventory, or the (unbound) menu key.
 */
public final class FilterScreen extends Screen {
    private static final int ROW = 20;
    private final Screen parent;
    private EditBox search;
    private List<OreCatalog.Family> all = List.of();
    private List<OreCatalog.Family> visible = new ArrayList<>();
    private int scroll;
    private int listX, listY, listW, listH;
    private int tick;

    public FilterScreen(Screen parent) {
        super(Component.literal("Seedscout"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        int right = 170;
        listX = 16;
        listY = 48;
        listW = width - right - 32;
        listH = height - listY - 36;
        search = new EditBox(font, listX, 24, listW, 18, Component.literal("search"));
        search.setHint(Component.literal("search ores ..."));
        search.setResponder(s -> refresh());
        addRenderableWidget(search);
        setInitialFocus(search);

        int cx = width - right, y = 24, w = right - 16;
        addRenderableWidget(Button.builder(Component.literal("All"), b -> set(List.of(OreFilter.ALL))).bounds(cx, y, w / 2 - 2, 20).build());
        addRenderableWidget(Button.builder(Component.literal("None"), b -> set(List.of())).bounds(cx + w / 2 + 2, y, w / 2 - 2, 20).build());
        y += 24;
        for (String preset : OreFilter.PRESETS.keySet()) {
            String label = preset.substring(0, 1).toUpperCase(Locale.ROOT) + preset.substring(1);
            addRenderableWidget(Button.builder(Component.literal(label), b -> set(List.of(preset))).bounds(cx, y, w, 20).build());
            y += 22;
        }
        y += 6;
        addRenderableWidget(new AbstractSliderButton(cx, y, w, 20, Component.empty(), (ClientConfig.RANGE.get() - 1) / 15.0) {
            { updateMessage(); }
            @Override protected void updateMessage() { setMessage(Component.literal("Range: " + (1 + Math.round(value * 15)) + " chunks")); }
            @Override protected void applyValue() { ClientConfig.RANGE.set((int) (1 + Math.round(value * 15))); ClientConfig.SPEC.save(); }
        });
        y += 24;
        addRenderableWidget(new AbstractSliderButton(cx, y, w, 20, Component.empty(), (ClientConfig.OPACITY.get() - 10) / 90.0) {
            { updateMessage(); }
            @Override protected void updateMessage() { setMessage(Component.literal("Opacity: " + (10 + Math.round(value * 90)) + "%")); }
            @Override protected void applyValue() { ClientConfig.OPACITY.set((int) (10 + Math.round(value * 90))); ClientConfig.SPEC.save(); }
        });
        y += 24;
        addRenderableWidget(new Checkbox(cx, y, w, 20, Component.literal("Legend"), ClientConfig.LEGEND.get()) {
            @Override public void onPress() { super.onPress(); ClientConfig.LEGEND.set(selected()); ClientConfig.SPEC.save(); }
        });
        y += 24;
        addRenderableWidget(new Checkbox(cx, y, w, 20, Component.literal("Overlay on"), ClientConfig.OVERLAY_ON.get()) {
            @Override public void onPress() { super.onPress(); ClientConfig.OVERLAY_ON.set(selected()); ClientConfig.SPEC.save(); }
        });
        addRenderableWidget(Button.builder(Component.literal("Done"), b -> onClose()).bounds(cx, height - 30, w, 20).build());
        reload();
    }

    private void set(List<String> shown) {
        ClientConfig.setShown(shown);
    }

    private void reload() {
        all = OreCatalog.families();
        refresh();
    }

    private void refresh() {
        String q = search == null ? "" : search.getValue().toLowerCase(Locale.ROOT).trim();
        visible = new ArrayList<>();
        for (OreCatalog.Family f : all) {
            if (q.isEmpty() || f.name().contains(q) || f.displayName().toLowerCase(Locale.ROOT).contains(q)
                    || f.ids().stream().anyMatch(id -> id.contains(q))) visible.add(f);
        }
        scroll = Math.max(0, Math.min(scroll, maxScroll()));
    }

    private int maxScroll() {
        return Math.max(0, visible.size() * ROW - listH);
    }

    @Override
    public void tick() {
        super.tick();
        if (++tick % 20 == 0) reload();
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        renderBackground(g);
        g.drawString(font, "Seedscout ores", listX, 10, 0xFFFFFF);
        List<String> shown = OreFilter.expand(ClientConfig.shown());
        Map<String, Integer> colors = ClientConfig.colors();
        g.fill(listX - 2, listY - 2, listX + listW + 2, listY + listH + 2, 0x80000000);
        g.enableScissor(listX, listY, listX + listW, listY + listH);
        int y = listY - scroll;
        for (OreCatalog.Family f : visible) {
            if (y + ROW >= listY && y <= listY + listH) {
                boolean on = isOn(f, shown);
                // checkbox
                g.fill(listX + 2, y + 3, listX + 16, y + 17, 0xFF2A2A2A);
                g.renderOutline(listX + 2, y + 3, 14, 14, 0xFFAAAAAA);
                if (on) g.fill(listX + 5, y + 6, listX + 13, y + 14, 0xFF7FDB7F);
                // swatch
                int rgb = OreRenderer.colorOf(f.ids().get(0), colors);
                g.fill(listX + 22, y + 3, listX + 36, y + 17, 0xFF000000 | rgb);
                g.renderOutline(listX + 22, y + 3, 14, 14, 0xFF000000);
                // name and count
                String label = f.displayName() + "  (" + f.name() + ")";
                g.drawString(font, label, listX + 42, y + 6, on ? 0xFFFFFF : 0x909090);
                String count = f.nearby() > 0 ? String.valueOf(f.nearby()) : "-";
                g.drawString(font, count, listX + listW - 8 - font.width(count), y + 6, 0xA0A0A0);
            }
            y += ROW;
        }
        g.disableScissor();
        if (maxScroll() > 0) {
            int barH = Math.max(10, listH * listH / (visible.size() * ROW));
            int barY = listY + (listH - barH) * scroll / maxScroll();
            g.fill(listX + listW - 3, barY, listX + listW, barY + barH, 0xFFC0C0C0);
        }
        String status = "scout: " + (ScoutProcess.isRunning() ? "running" : "stopped") + ", " + (ScoutLink.isConnected() ? "connected" : "not connected")
                + ", " + OreRenderer.lastDrawn + " boxes drawn, " + visible.size() + "/" + all.size() + " ores listed";
        g.drawString(font, status, listX, height - 24, 0xA0A0A0);
        g.drawString(font, "click the box to show or hide, the color to change it", listX, height - 13, 0x707070);
        super.render(g, mouseX, mouseY, partialTick);
    }

    private static boolean isOn(OreCatalog.Family f, List<String> shown) {
        for (String id : f.ids()) if (OreFilter.isShown(id, shown)) return true;
        return false;
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        if (button == 0 && mx >= listX && mx < listX + listW && my >= listY && my < listY + listH) {
            int idx = (int) ((my - listY + scroll) / ROW);
            if (idx >= 0 && idx < visible.size()) {
                OreCatalog.Family f = visible.get(idx);
                if (mx < listX + 20) {
                    List<String> shown = OreFilter.expand(ClientConfig.shown());
                    ClientConfig.setShown(OreFilter.toggle(shown, f.name(), !isOn(f, shown), OreCatalog.familyNames()));
                } else if (mx < listX + 40) {
                    Minecraft.getInstance().setScreen(new ColorScreen(this, f));
                } else {
                    List<String> shown = OreFilter.expand(ClientConfig.shown());
                    ClientConfig.setShown(OreFilter.toggle(shown, f.name(), !isOn(f, shown), OreCatalog.familyNames()));
                }
                return true;
            }
        }
        return super.mouseClicked(mx, my, button);
    }

    @Override
    public boolean mouseScrolled(double mx, double my, double delta) {
        if (mx >= listX && mx < listX + listW && my >= listY && my < listY + listH) {
            scroll = Math.max(0, Math.min(maxScroll(), scroll - (int) (delta * ROW * 2)));
            return true;
        }
        return super.mouseScrolled(mx, my, delta);
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }

    @Override
    public void onClose() {
        Minecraft.getInstance().setScreen(parent);
    }

    /** One family's color: a hex field and a row of preset swatches. */
    static final class ColorScreen extends Screen {
        private static final int[] SWATCHES = {0xFF6B6B, 0xFFD93D, 0x6BCB77, 0x4D96FF, 0xC77DFF, 0xFF9F1C, 0x2EC4B6, 0xF15BB5,
                0xFFFFFF, 0x4AEDD9, 0x8B4A2B, 0xD8AF93, 0xFCEE4B, 0x17DD62, 0xFF0000, 0x1F4BD6};
        private final Screen parent;
        private final OreCatalog.Family family;
        private EditBox hex;

        ColorScreen(Screen parent, OreCatalog.Family family) {
            super(Component.literal("Color of " + family.displayName()));
            this.parent = parent;
            this.family = family;
        }

        @Override
        protected void init() {
            int cx = width / 2;
            hex = new EditBox(font, cx - 60, 70, 120, 20, Component.literal("hex"));
            hex.setMaxLength(7);
            hex.setValue(String.format("%06X", OreRenderer.colorOf(family.ids().get(0), ClientConfig.colors())));
            addRenderableWidget(hex);
            addRenderableWidget(Button.builder(Component.literal("Apply"), b -> apply(hex.getValue())).bounds(cx - 60, 96, 120, 20).build());
            addRenderableWidget(Button.builder(Component.literal("Back"), b -> onClose()).bounds(cx - 60, 170, 120, 20).build());
        }

        private void apply(String text) {
            try {
                int rgb = Integer.parseInt(text.replace("#", "").trim(), 16) & 0xFFFFFF;
                ClientConfig.setColor(family.name(), rgb);
                hex.setValue(String.format("%06X", rgb));
            } catch (NumberFormatException ignored) {
            }
        }

        @Override
        public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
            renderBackground(g);
            g.drawCenteredString(font, title.getString(), width / 2, 30, 0xFFFFFF);
            int rgb = OreRenderer.colorOf(family.ids().get(0), ClientConfig.colors());
            g.fill(width / 2 - 60, 46, width / 2 + 60, 66, 0xFF000000 | rgb);
            int x0 = width / 2 - 8 * 15 + 2, y0 = 130;
            for (int i = 0; i < SWATCHES.length; i++) {
                int x = x0 + (i % 8) * 30, y = y0 + (i / 8) * 18;
                g.fill(x, y, x + 26, y + 14, 0xFF000000 | SWATCHES[i]);
            }
            super.render(g, mouseX, mouseY, partialTick);
        }

        @Override
        public boolean mouseClicked(double mx, double my, int button) {
            int x0 = width / 2 - 8 * 15 + 2, y0 = 130;
            for (int i = 0; i < SWATCHES.length; i++) {
                int x = x0 + (i % 8) * 30, y = y0 + (i / 8) * 18;
                if (mx >= x && mx < x + 26 && my >= y && my < y + 14) {
                    apply(String.format("%06X", SWATCHES[i]));
                    return true;
                }
            }
            return super.mouseClicked(mx, my, button);
        }

        @Override
        public boolean isPauseScreen() {
            return false;
        }

        @Override
        public void onClose() {
            Minecraft.getInstance().setScreen(parent);
        }
    }
}
