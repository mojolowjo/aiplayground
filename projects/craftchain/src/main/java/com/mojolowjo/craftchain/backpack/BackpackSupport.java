package com.mojolowjo.craftchain.backpack;

import com.mojolowjo.craftchain.ClientConfig;
import com.mojolowjo.craftchain.CraftChain;
import com.mojolowjo.craftchain.planning.ItemCounts;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import net.minecraft.world.item.ItemStack;
import net.minecraftforge.fml.ModList;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Reads what is inside the player's Sophisticated Backpacks, without opening them.
 *
 * Facts (read from the Sophisticated Backpacks / Core 1.20.x sources):
 * <ul>
 *   <li>Contents live on the server in {@code BackpackStorage}, keyed by the {@code contentsUuid}
 *       in the backpack item's NBT. The client has a copy that is filled only when the server sends
 *       {@code BackpackContentsMessage}.</li>
 *   <li>The client may ask for a backpack's contents with
 *       {@code RequestBackpackInventoryContentsMessage(uuid, ItemStackReference)}; the mod does this
 *       for its hover tooltip. {@code ItemStackReference(containerId, slot, handlerName, identifier)}
 *       is {@code (-1, slot, "", "")} for the player inventory and {@code (-2, slot, handler, id)}
 *       for an equipment handler such as Curios.</li>
 * </ul>
 *
 * Everything is done through reflection so this mod needs no compile-time dependency on
 * Sophisticated Backpacks and still loads (and the dev client still runs) without it. If any class
 * or method is missing, the feature turns itself off and says so once in the log.
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
    /** Parameter kinds of requestCtor, resolved at init: 'u' = UUID, 'r' = ItemStackReference, 'i' = int slot, 's' = String. */
    private static char[] requestShape;
    private static Object packetHandler;
    private static Method sendToServer;
    private static Method storageGet;
    private static Method getContents;

    /** UUIDs of the backpacks we know the player carries, refreshed on every scan. */
    private static final List<UUID> knownBackpacks = new ArrayList<>();
    private static ItemCounts cached = new ItemCounts();
    private static int ticksUntilScan;

    private BackpackSupport() {}

    public static boolean sophisticatedBackpacksLoaded() {
        return ModList.get().isLoaded("sophisticatedbackpacks");
    }

    public static boolean curiosLoaded() {
        return ModList.get().isLoaded("curios");
    }

    /** True when the reflection hooks resolved and the feature is on. */
    public static boolean working() {
        init();
        return available;
    }

    /** Item counts across every backpack we have heard back about. Cheap: it is a cached map. */
    public static ItemCounts cachedContents() {
        return cached;
    }

    /** Call once per client tick. Sends a contents request for each backpack every few seconds. */
    public static void tick(boolean wanted) {
        if (!wanted || !ClientConfig.BACKPACKS_ENABLED.get()) {
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

    /** Scan now (also used by the pin/craft keys so the first answer arrives quickly). */
    public static void requestNow() {
        init();
        if (available) {
            ticksUntilScan = ClientConfig.BACKPACK_REFRESH_TICKS.get();
            scan();
        }
    }

    private static void scan() {
        LocalPlayer player = Minecraft.getInstance().player;
        if (player == null) {
            return;
        }
        knownBackpacks.clear();
        try {
            // Main inventory + hotbar (slots 0-35), armor (36-39), offhand (40).
            int size = player.getInventory().getContainerSize();
            for (int slot = 0; slot < size; slot++) {
                ItemStack stack = player.getInventory().getItem(slot);
                if (isBackpack(stack)) {
                    request(stack, -1, slot, "", "");
                }
            }
            if (curiosLoaded()) {
                for (CuriosAccess.Found f : CuriosAccess.findBackpacks(player, BackpackSupport::isBackpack)) {
                    request(f.stack(), -2, f.slot(), "curios", f.identifier());
                }
            }
        } catch (Throwable t) {
            disable("sending a contents request failed: " + t);
            return;
        }
        rebuildCache();
    }

    private static void request(ItemStack stack, int containerId, int slot, String handler, String identifier) throws Exception {
        Optional<UUID> uuid = contentsUuid(stack);
        if (uuid.isEmpty()) {
            return; // a backpack that was never opened has no contents yet
        }
        knownBackpacks.add(uuid.get());
        Object[] args = new Object[requestShape.length];
        for (int i = 0; i < requestShape.length; i++) {
            args[i] = switch (requestShape[i]) {
                case 'u' -> uuid.get();
                case 'r' -> referenceCtor.newInstance(containerId, slot, handler, identifier);
                case 'i' -> slot;
                default -> handler;
            };
        }
        if (containerId == -2 && !hasShape('r')) {
            return; // an older message cannot point at an equipment slot; inventory backpacks still work
        }
        Object message = requestCtor.newInstance(args);
        sendToServer.invoke(packetHandler, message);
    }

    private static boolean hasShape(char kind) {
        for (char c : requestShape) {
            if (c == kind) {
                return true;
            }
        }
        return false;
    }

    /** Re-read the client-side copy of every known backpack's contents. */
    private static void rebuildCache() {
        ItemCounts counts = new ItemCounts();
        try {
            Object storage = storageGet.invoke(null);
            for (UUID uuid : knownBackpacks) {
                Object opt = getContents.invoke(storage, uuid);
                if (!(opt instanceof Optional<?> o) || o.isEmpty() || !(o.get() instanceof CompoundTag tag)) {
                    continue;
                }
                CompoundTag inventory = tag.getCompound("inventory");
                ListTag items = inventory.getList("Items", Tag.TAG_COMPOUND);
                for (int i = 0; i < items.size(); i++) {
                    ItemStack stack = ItemStack.of(items.getCompound(i));
                    if (!stack.isEmpty()) {
                        counts.add(stack.getItem(), stack.getCount());
                    }
                }
            }
        } catch (Throwable t) {
            disable("reading backpack contents failed: " + t);
            return;
        }
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
                // Older Sophisticated Core: the request message then takes a slot number instead.
            }

            step = "RequestBackpackInventoryContentsMessage";
            Class<?> requestClass = Class.forName(SB + "network.RequestBackpackInventoryContentsMessage");
            requestCtor = pickRequestConstructor(requestClass, referenceClass);

            step = "SBPPacketHandler";
            Class<?> handlerClass = Class.forName(SB + "network.SBPPacketHandler");
            packetHandler = handlerClass.getField("INSTANCE").get(null);
            sendToServer = findMethod(packetHandler.getClass(), "sendToServer", 1);

            step = "BackpackStorage";
            Class<?> storageClass = Class.forName(SB + "backpack.BackpackStorage");
            storageGet = storageClass.getMethod("get");
            getContents = storageClass.getMethod("getBackpackContents", UUID.class);

            available = true;
            failReason = "";
            CraftChain.LOGGER.info("Sophisticated Backpacks hooks ready; request shape {}", new String(requestShape));
        } catch (Throwable t) {
            disable("hooks did not resolve at " + step + ": " + t);
        }
    }

    /** Finds a public constructor we can satisfy and records which argument goes where. */
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
    }

    /** For /craftchain status. Includes the failure reason so nobody has to dig through logs. */
    public static String describe() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("sophisticatedbackpacks", sophisticatedBackpacksLoaded());
        m.put("curios", curiosLoaded());
        m.put("hooks", working());
        m.put("backpacksSeen", knownBackpacks.size());
        m.put("itemsCounted", cached.total());
        if (!failReason.isEmpty()) {
            m.put("why", failReason);
        }
        return m.toString();
    }
}
