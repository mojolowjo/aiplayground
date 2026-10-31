package com.mojolowjo.craftchain.backpack;

import net.minecraftforge.fml.ModList;

/**
 * Placeholder for the backpack feature. See docs/OUTLINE.md, "Phase 3: backpacks".
 *
 * What is known (read from the Sophisticated Backpacks 1.20.x source, 2026-10-31):
 * <ul>
 *   <li>MC Eternal 2 ships Sophisticated Backpacks (+ Sophisticated Core) and Curios API; the
 *       "backpack slot" is Curios' {@code back} slot.</li>
 *   <li>Contents live on the server in {@code BackpackStorage} (world saved data), keyed by a UUID
 *       stored in the item's NBT. The client has an empty copy that is filled only by
 *       {@code BackpackContentsMessage}.</li>
 *   <li>The client can ask for a backpack's contents WITHOUT opening it: it sends
 *       {@code RequestBackpackInventoryContentsMessage(uuid, ItemStackReference)} (the mod uses
 *       this for its hover tooltip) and the server answers with the inventory NBT. The reference
 *       names a container slot, or an equipment handler + identifier + slot for the Curios slot.</li>
 *   <li>Taking items out still needs the backpack screen: {@code BackpackOpenMessage(slot,
 *       identifier, handlerName)} opens any backpack the player has, including the Curios one, and
 *       the resulting {@code BackpackContainer} is an ordinary menu we can shift-click.</li>
 * </ul>
 */
public final class BackpackSupport {
    public static boolean sophisticatedBackpacksLoaded() {
        return ModList.get().isLoaded("sophisticatedbackpacks");
    }

    public static boolean curiosLoaded() {
        return ModList.get().isLoaded("curios");
    }

    private BackpackSupport() {}
}
