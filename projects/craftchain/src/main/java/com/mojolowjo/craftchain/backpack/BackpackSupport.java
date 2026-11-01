package com.mojolowjo.craftchain.backpack;

import com.mojolowjo.craftchain.ClientConfig;
import com.mojolowjo.craftchain.CraftChain;
import com.mojolowjo.craftchain.planning.ItemCounts;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.item.ItemStack;
import net.minecraftforge.fml.ModList;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Reads what is inside the player's Sophisticated Backpacks without opening them, and can open one.
 *
 * Facts (read from the Sophisticated Backpacks / Core 1.20.x sources):
 * <ul>
 *   <li>Contents live on the server in {@code BackpackStorage}, keyed by the {@code contentsUuid}
 *       in the backpack item's NBT. The client has a copy that is filled only when the server sends
 *       {@code BackpackContentsMessage}.</li>
 *   <li>The client may ask for a backpack's contents with
 *       {@code RequestBackpackInventoryContentsMessage}; the mod does this for its hover tooltip.
 *       The pack's build (3.24) takes just the UUID; newer builds take an {@code ItemStackReference}
 *       too. Both shapes are handled.</li>
 *   <li>{@code BackpackOpenMessage(int slot, String identifier, String handlerName)} asks the
 *       server to open a backpack from a player inventory handler ("main" for the inventory,
 *       "curios" + slot id for Curios); the no-arg form opens the first backpack found.</li>
 * </ul>
 *
 * Everything is done through reflection so this mod needs no compile-time dependency and the
 * dev client still runs. If a hook is missing, the feature turns itself off and /craftchain status
 * says why.
 */
public final class BackpackSupport {
    private static final String SB = "net.p3pp3rf1y.sophisticatedbackpacks.";
    private static final String CORE = "net.p3pp3rf1y.sophisticatedcore.";

    private static boolean initialised;
    private static boolean available;
    private static String failReason = "";
    private static Class<?> backpackItemClass;
    private static Constructor<?> referenceCtor;
    private static Constructor<?> requestCtor;
    private static char[] requestShape;
    private static Constructor<?> openCtor;
    private static Constructor<?> openCtorNoArg;
    private static Object packetHandler;
    private static Method sendToServer;
    private static Method storageGet;
    private static Method getContents;

    private static List<BackpackInfo> backpacks = Collections.emptyList();
    private static ItemCounts cached = new ItemCounts();
    private static int ticksUntilScan;
    private static int scanCount;
    private static int backpackItemsFound;
    private static int curiosChecked;
    private static int requestsSent;

    private BackpackSupport() {}

    public static boolean sophisticatedBackpacksLoaded() {
        return ModList.get().isLoaded("sophisticatedbackpacks");
    }

    public static boolean curiosLoaded() {
        return ModList.get().isLoaded("curios");
    }

    public static boolean working() {
        init();
        return available;
    }

    /** Item counts across every backpack we have heard back about. */
    public static ItemCounts cachedContents() {
        return cached;
    }

    /** The backpacks found on the last scan, with their contents. */
    public static List<BackpackInfo> backpacks() {
        return backpacks;
    }

    /** Goes up on every scan; cheap way for others to notice new data. */
    public static int scanCount() {
        return scanCount;
    }

    /** Call once per client tick while in a world. Sends a contents request for each backpack every few seconds. */
    public static void tick() {
        if (!ClientConfig.BACKPACKS_ENABLED.get()) {
            return;
        }
        init();
        if (!available) {
            return;
        }
        if (ticksUntilScan-- > 0) {
            return;
        }
        ticksUntilScan = ClientConfig.BACKPACK_REFRESH_TICKS.get();
        scan();
    }

    /** Scan now (used before planning so the numbers are fresh). */
    public static void requestNow() {
        init();
        if (available && ClientConfig.BACKPACKS_ENABLED.get()) {
            ticksUntilScan = ClientConfig.BACKPACK_REFRESH_TICKS.get();
            scan();
        }
    }

    /** True when the open menu is a Sophisticated Backpacks screen. */
    public static boolean isBackpackMenu(AbstractContainerMenu menu) {
        return menu != null && menu.getClass().getName().startsWith(SB) && menu.getClass().getSimpleName().contains("Backpack");
    }

    /** Asks the server to open this backpack. Returns false when the hook is unavailable. */
    public static boolean open(BackpackInfo pack) {
        init();
        if (!available || openCtor == null) {
            return false;
        }
        try {
            Object message = pack.inCurios()
                    ? openCtor.newInstance(pack.curiosSlot(), pack.curiosId(), "curios")
                    : openCtor.newInstance(pack.inventorySlot(), "", "main");
            sendToServer.invoke(packetHandler, message);
            return true;
        } catch (Throwable t) {
            CraftChain.LOGGER.warn("Could not open backpack {}: {}", pack.describe(), t.toString());
            return false;
        }
    }

    /** The mod's fallback: open whichever backpack it finds first. */
    public static boolean openFirst() {
        init();
        if (!available || openCtorNoArg == null) {
            return false;
        }
        try {
            sendToServer.invoke(packetHandler, openCtorNoArg.newInstance());
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    // ---- scanning --------------------------------------------------------------------------

    private static void scan() {
        LocalPlayer player = Minecraft.getInstance().player;
        if (player == null) {
            return;
        }
        List<BackpackInfo> found = new ArrayList<>();
        backpackItemsFound = 0;
        curiosChecked = 0;
        try {
            int size = player.getInventory().getContainerSize();
            for (int slot = 0; slot < size; slot++) {
                ItemStack stack = player.getInventory().getItem(slot);
                if (isBackpack(stack)) {
                    backpackItemsFound++;
                    final int at = slot;
                    contentsUuid(stack).ifPresent(uuid -> found.add(new BackpackInfo(uuid, stack.copy(), at, "", 0, new ItemCounts())));
                }
            }
            if (curiosLoaded()) {
                List<CuriosAccess.Found> curios = CuriosAccess.findBackpacks(player, BackpackSupport::isBackpack);
                curiosChecked = curios.size();
                for (CuriosAccess.Found f : curios) {
                    backpackItemsFound++;
                    contentsUuid(f.stack()).ifPresent(uuid -> found.add(new BackpackInfo(uuid, f.stack().copy(), -1, f.identifier(), f.slot(), new ItemCounts())));
                }
            }
            for (BackpackInfo pack : found) {
                request(pack);
            }
        } catch (Throwable t) {
            disable("sending a contents request failed: " + t);
            return;
        }
        rebuildCache(found);
        scanCount++;
    }

    private static void request(BackpackInfo pack) throws Exception {
        Object[] args = new Object[requestShape.length];
        for (int i = 0; i < requestShape.length; i++) {
            args[i] = switch (requestShape[i]) {
                case 'u' -> pack.uuid();
                case 'r' -> pack.inCurios()
                        ? referenceCtor.newInstance(-2, pack.curiosSlot(), "curios", pack.curiosId())
                        : referenceCtor.newInstance(-1, pack.inventorySlot(), "", "");
                case 'i' -> pack.inventorySlot();
                default -> "";
            };
        }
        if (pack.inCurios() && hasShape('i') && !hasShape('r')) {
            return; // a slot-number-only message cannot point at an equipment slot
        }
        sendToServer.invoke(packetHandler, requestCtor.newInstance(args));
        requestsSent++;
    }

    private static boolean hasShape(char kind) {
        for (char c : requestShape) {
            if (c == kind) {
                return true;
            }
        }
        return false;
    }

    private static void rebuildCache(List<BackpackInfo> found) {
        ItemCounts counts = new ItemCounts();
        try {
            Object storage = storageGet.invoke(null);
            for (BackpackInfo pack : found) {
                Object result = getContents.invoke(storage, pack.uuid());
                if (result instanceof Optional<?> o) {
                    result = o.orElse(null);
                }
                if (!(result instanceof CompoundTag tag)) {
                    continue;
                }
                ListTag items = tag.getCompound("inventory").getList("Items", Tag.TAG_COMPOUND);
                for (int i = 0; i < items.size(); i++) {
                    ItemStack stack = ItemStack.of(items.getCompound(i));
                    if (!stack.isEmpty()) {
                        pack.contents().add(stack.getItem(), stack.getCount());
                        counts.add(stack.getItem(), stack.getCount());
                    }
                }
            }
        } catch (Throwable t) {
            disable("reading backpack contents failed: " + t);
            return;
        }
        backpacks = found;
        cached = counts;
    }

    private static boolean isBackpack(ItemStack stack) {
        return !stack.isEmpty() && backpackItemClass.isInstance(stack.getItem());
    }

    private static Optional<UUID> contentsUuid(ItemStack stack) {
        CompoundTag tag = stack.getTag();
        if (tag != null && tag.hasUUID("contentsUuid")) {
            return Optional.of(tag.getUUID("contentsUuid"));
        }
        return Optional.empty();
    }

    // ---- reflection setup ------------------------------------------------------------------

    private static synchronized void init() {
        if (initialised) {
            return;
        }
        initialised = true;
        if (!sophisticatedBackpacksLoaded()) {
            return;
        }
        String step = "BackpackItem";
        try {
            backpackItemClass = Class.forName(SB + "backpack.BackpackItem");

            step = "ItemStackReference";
            Class<?> referenceClass = null;
            try {
                referenceClass = Class.forName(CORE + "network.ItemStackReference");
                referenceCtor = referenceClass.getConstructor(int.class, int.class, String.class, String.class);
            } catch (ClassNotFoundException | NoSuchMethodException ignored) {
                // Older Sophisticated Core: the request message takes the UUID only.
            }

            step = "RequestBackpackInventoryContentsMessage";
            Class<?> requestClass = Class.forName(SB + "network.RequestBackpackInventoryContentsMessage");
            requestCtor = pickRequestConstructor(requestClass, referenceClass);

            step = "BackpackOpenMessage";
            try {
                Class<?> openClass = Class.forName(SB + "network.BackpackOpenMessage");
                openCtor = openClass.getConstructor(int.class, String.class, String.class);
                openCtorNoArg = openClass.getConstructor();
            } catch (ReflectiveOperationException e) {
                CraftChain.LOGGER.warn("Backpack opening unavailable: {}", e.toString()); // counting still works
            }

            step = "SBPPacketHandler";
            Class<?> handlerClass = Class.forName(SB + "network.SBPPacketHandler");
            packetHandler = handlerClass.getField("INSTANCE").get(null);
            sendToServer = findMethod(packetHandler.getClass(), "sendToServer", 1);

            step = "BackpackStorage";
            Class<?> storageClass = Class.forName(SB + "backpack.BackpackStorage");
            storageGet = storageClass.getMethod("get");
            try {
                getContents = storageClass.getMethod("getBackpackContents", UUID.class);
            } catch (NoSuchMethodException older) {
                getContents = storageClass.getMethod("getOrCreateBackpackContents", UUID.class);
            }

            available = true;
            failReason = "";
            CraftChain.LOGGER.info("Sophisticated Backpacks hooks ready; request shape {}", new String(requestShape));
        } catch (Throwable t) {
            disable("hooks did not resolve at " + step + ": " + t);
        }
    }

    private static Constructor<?> pickRequestConstructor(Class<?> requestClass, Class<?> referenceClass) throws NoSuchMethodException {
        StringBuilder seen = new StringBuilder();
        for (Constructor<?> c : requestClass.getConstructors()) {
            Class<?>[] p = c.getParameterTypes();
            char[] shape = new char[p.length];
            boolean ok = true;
            boolean hasUuid = false;
            for (int i = 0; i < p.length; i++) {
                if (p[i] == UUID.class) {
                    shape[i] = 'u';
                    hasUuid = true;
                } else if (referenceClass != null && p[i] == referenceClass) {
                    shape[i] = 'r';
                } else if (p[i] == int.class) {
                    shape[i] = 'i';
                } else if (p[i] == String.class) {
                    shape[i] = 's';
                } else {
                    ok = false;
                }
            }
            seen.append(c.toGenericString()).append("; ");
            if (ok && hasUuid) {
                requestShape = shape;
                return c;
            }
        }
        throw new NoSuchMethodException("no usable constructor; found: " + seen);
    }

    private static Method findMethod(Class<?> type, String name, int params) throws NoSuchMethodException {
        for (Class<?> c = type; c != null; c = c.getSuperclass()) {
            for (Method m : c.getMethods()) {
                if (m.getName().equals(name) && m.getParameterCount() == params) {
                    m.setAccessible(true);
                    return m;
                }
            }
        }
        throw new NoSuchMethodException(type.getName() + "#" + name);
    }

    private static void disable(String why) {
        CraftChain.LOGGER.warn("Backpack support disabled: {}", why);
        failReason = why;
        available = false;
        cached = new ItemCounts();
        backpacks = Collections.emptyList();
    }

    /** For /craftchain status. */
    public static String describe() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("sophisticatedbackpacks", sophisticatedBackpacksLoaded());
        m.put("curios", curiosLoaded());
        m.put("hooks", working());
        m.put("canOpen", openCtor != null);
        m.put("backpackItems", backpackItemsFound);
        m.put("inCurios", curiosChecked);
        m.put("withContentsId", backpacks.size());
        m.put("requestsSent", requestsSent);
        m.put("itemsCounted", cached.total());
        if (requestShape != null) {
            m.put("shape", new String(requestShape));
        }
        if (!failReason.isEmpty()) {
            m.put("why", failReason);
        }
        return m.toString();
    }
}
