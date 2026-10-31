# Research notes (2026-10-31)

What was looked into before and while writing CraftChain, what was found, what was not, and the
sources. Everything marked **verified** was read from the actual source or page; everything marked
**from memory** was not checked and should be before relying on it.

## 1. Toolchain

| Item | Finding | Source |
|---|---|---|
| Forge 1.20.1 47.4.2 | Exists (2025-06-11). Not the newest: 47.4.28 is latest and recommended as of 2026-10-31. Nothing between them changes the MDK, mods.toml or Gradle setup. 47.4.9 and 47.4.17 only bump ASM for newer Java runtimes. | https://files.minecraftforge.net/net/minecraftforge/forge/index_1.20.1.html, per-version changelog.txt next to each zip on maven.minecraftforge.net |
| MDK | `forge-1.20.1-47.4.2-mdk.zip` from maven.minecraftforge.net. ForgeGradle `[6.0,6.2)`, Gradle wrapper **8.8**, `official` mappings 1.20.1, Java toolchain 17, foojay resolver 0.7.0. **verified** (downloaded and used) | https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.4.2/forge-1.20.1-47.4.2-mdk.zip |
| `clientSideOnly=true` in mods.toml | Supported on Forge 1.20.1 since **47.3.25** (backport of the 1.20.4 feature). Sets display test to IGNORE_ALL_VERSION and skips loading the mod on dedicated servers. **verified** (in the 47.4.2 MDK template) | https://github.com/MinecraftForge/MinecraftForge/pull/10085 |
| Java on this PC | JDK 17.0.1 at `C:\Program Files\Java\jdk-17.0.1`; Java 25 is first on PATH. Gradle 8.8 cannot run on Java 25, so `JAVA_HOME` must point at 17 before `gradlew`. **verified** (first attempt would have failed otherwise) | https://docs.gradle.org/current/userguide/compatibility.html |
| First build | Downloads Minecraft + MCPConfig and decompiles: ~6 minutes, needs network. Later builds ~1 minute. The decompiled sources jar is only produced by an IDE task (`gradlew eclipse`), which is how the vanilla sources below were read. **verified** | this project's build logs |
| JEI Maven | `https://maven.blamejared.com`, group `mezz.jei`, artifacts `jei-1.20.1-common-api`, `jei-1.20.1-forge-api`, `jei-1.20.1-forge`. Latest 1.20.1 build **15.74.0.233** (2026-10-29); the project pins 15.20.0.106, an older build, so every API used exists in any JEI 15 the pack might ship. **verified** (maven-metadata.xml fetched) | https://maven.blamejared.com/mezz/jei/jei-1.20.1-forge/maven-metadata.xml |
| Curios Maven | `https://maven.theillusivec4.top/`, `top.theillusivec4.curios:curios-forge:5.14.1+1.20.1` (`:api` classifier for compile). **verified** | https://maven.theillusivec4.top/top/theillusivec4/curios/curios-forge/maven-metadata.xml |
| Sophisticated Backpacks Maven | Only via CurseMaven: `curse.maven:sophisticated-backpacks-422301:<fileId>` and `curse.maven:sophisticated-core-618298:<fileId>`. Latest 1.20.1 files on 2026-10-30: backpacks 3.26.18.2237 (file 9373688), core 1.5.19.2441 (file 9373650). Not yet added to the build. | https://cursemaven.com, CurseForge file pages |

## 2. JEI 15 API (branch `1.20.1` of mezz/JustEnoughItems)

All **verified** by the research agent against the GitHub sources:

* Plugin: `@mezz.jei.api.JeiPlugin` on a class implementing `IModPlugin` with a no-arg constructor.
  `getPluginUid()`, `onRuntimeAvailable(IJeiRuntime)`, `onRuntimeUnavailable()`.
* Hover: `IIngredientListOverlay.getIngredientUnderMouse()` -> `Optional<ITypedIngredient<?>>` (since 9.3.0),
  `IBookmarkOverlay.getIngredientUnderMouse()`, `IRecipesGui.getIngredientUnderMouse(IIngredientType<T>)` -> `Optional<T>`.
  `ITypedIngredient.getItemStack()` -> `Optional<ItemStack>`. `VanillaTypes.ITEM_STACK`.
  The overlay reads the live mouse position itself, so these can be called from any event handler.
* Keyboard focus: `IIngredientListOverlay.hasKeyboardFocus()`.
* JEI's own key handling is Forge `ScreenEvent.KeyPressed.Pre` at NORMAL priority
  (`mezz.jei.forge.startup.EventRegistration`). A HIGH-priority listener runs first.
* **JEI's "+" transfer needs JEI on the server**: `BasicRecipeTransferHandler.transferRecipe` returns
  the "no server" error unless `serverConnection.isJeiOnServer()`; otherwise it sends JEI's own
  `PacketRecipeTransfer`. Not usable for a client-only mod.
* Recipe lookup through JEI: `IRecipeManager.createRecipeLookup(RecipeTypes.CRAFTING).limitFocus(...)`.
  Not used yet; the vanilla recipe manager is used instead.

## 3. Vanilla 1.20.1 crafting internals

Read from the decompiled, Mojang-mapped sources that ForgeGradle produced for this project
(**verified**):

* `MultiPlayerGameMode.handleInventoryMouseClick(containerId, slot, button, ClickType, player)`
  calls `menu.clicked(...)` locally, diffs the slots, and sends `ServerboundContainerClickPacket`
  with the menu's state id. So the client's menu reflects each click immediately.
* `MultiPlayerGameMode.handlePlaceRecipe` sends `ServerboundPlaceRecipePacket`; on the server
  `ServerPlaceRecipe.recipeClicked` **returns early unless `player.getRecipeBook().contains(recipe)`**,
  then only places if `StackedContents.canCraft` passes, else sends a ghost recipe. This is why the
  mod does not use it.
* `CraftingMenu` slots: 0 result, 1-9 grid, 10-36 inventory, 37-45 hotbar. `InventoryMenu`:
  0 result, 1-4 grid, 5-8 armor, 9-35 inventory, 36-44 hotbar, 45 offhand.
* `CraftingMenu.quickMoveStack(player, 0)` moves the result into slots 10-45 and, if only part
  fits, **drops the rest on the ground** (`player.drop`). `AbstractContainerMenu.clicked` with
  QUICK_MOVE loops on the result slot until the output changes, which is how one shift-click
  crafts everything the grid holds.
* `Recipe` (interface): `getIngredients()`, `getResultItem(RegistryAccess)`, `canCraftInDimensions(w,h)`,
  `isSpecial()`. `ShapedRecipe` implements Forge's `IShapedRecipe` (`getRecipeWidth/Height`).
* `RecipeManager.getAllRecipesFor(RecipeType.CRAFTING)` -> `List<CraftingRecipe>`; the client's copy
  is replaced on `ClientboundUpdateRecipesPacket`, which Forge surfaces as `RecipesUpdatedEvent`.
* Forge: `ScreenEvent.KeyPressed.Pre` (getKeyCode/getScanCode/getScreen, cancellable),
  `RegisterKeyMappingsEvent`, `RegisterGuiOverlaysEvent.registerAboveAll(id, IGuiOverlay)`,
  `RegisterClientCommandsEvent`, `TickEvent.ClientTickEvent`, `KeyConflictContext.GUI`.

## 4. MC Eternal 2 (CurseForge, 649 dependencies, read 2026-10-31)

Read from the pack's CurseForge "Relations > Dependencies" pages (**verified**, all 7 pages). The
pack's own files page was not read, so the exact Forge/JEI/mod versions in v1.3 are **not
confirmed**; the user states Forge 47.4.2.

Directly relevant mods present:

| Mod | Why it matters |
|---|---|
| Just Enough Items (JEI) | the hook point |
| Curios API, Convenient Curios Container | the back slot for backpacks |
| Sophisticated Backpacks, Sophisticated Core, Sophisticated Storage, Sophisticated Item Actions, Sophisticated Tab | the backpacks; contents live server-side (see OUTLINE Phase 3) |
| Dank Storage, Luggage | other portable storage the player may keep items in |
| Crafting Tweaks | adds rotate/balance/clear buttons to the crafting screen; same menu class, so compatible |
| Mouse Tweaks | changes drag behaviour of the real mouse; does not affect programmatic clicks |
| Polymorph | server picks among conflicting recipes; could craft a different output than planned |
| Not Enough Recipe Book (NERB) | hides the vanilla recipe book; confirms the recipe-book packet path is a dead end |
| Crafting on a stick, Table Top Craft, Crafting Automat | alternative crafting menus; not driven by this mod |
| KubeJS (+ KubeJS Create/Curios, LootJS, MoreJS), Recipe Essentials | custom and removed recipes; only what reaches the client counts |
| FastSuite | async recipe matching on the server; may delay the result slot by a tick, hence `ticksAfterCraft` |
| Controlling, Raw's Visual keybinder | keybind searching; our keys appear under "CraftChain" |
| Create, Applied Energistics 2 (+ Crafting Tree, ME Requester), Mekanism, Thermal, Ender IO, Tinkers Construct, Integrated Crafting/Terminals, PneumaticCraft | their own crafting systems; their outputs are raw materials to this mod |
| Just Enough Resources, JEED, JEP, Just Enough Breeding, TConJEI, JEI/REI/EMI WorldGen | JEI plugins; no conflict expected |
| FTB Quests, FTB Library, FTB Chunks, Xaero's Minimap, Jade | HUD overlays that share the screen corners with the pinned list; move it via `hud.x`/`hud.y` |
| Packet Fixer | raises packet size limits; not relevant to click count |
| Item Borders, Legendary Tooltips, Prism, Iceberg | tooltip/GUI render mods; should not interfere with a key press |

Not present (checked): Refined Storage, Inventory Profiles Next, Just Enough Calculation,
Inventory HUD+, CraftAnyway, RecursiveCraft, JEI QuickCraft.

## 5. Prior art

| Project | Relevance | License |
|---|---|---|
| CraftAnyway (GeneraBlack) – 1.21.1 NeoForge, JEI 19 | Closest match: hover in JEI, press a key, plan a tree, click the crafting table. Uses `handleInventoryMouseClick` and a tick state machine with slots 0/1-9/10-45, exactly the approach taken here. | MIT |
| RecursiveCraft (xczl-785) – 1.20.1 Forge/Fabric | Server-side crafting; its JEI transfer handler is a good 1.20.1 example of sending `ServerboundPlaceRecipePacket` when JEI is absent on the server. | MIT |
| Just Enough Calculation (Towdium) | Raw-material calculator with recursion; the pinned list does a small subset of this. | LGPL-3 |
| JEI Crafting Tree (lhy512103) – 1.21.1 | Planning/checklist only. | MIT |
| JEI QuickCraft | 1.20.1 Forge, closed source, needs the mod on both sides. | ARR |
| Crafting Tweaks (BlayTheNinth) | Grid rotate/balance/clear with "simulated clicks"; in the pack. | see repo |

## 6. What was not done or not checked

* The pack's **exact mod versions** (Forge build, JEI build, Sophisticated Backpacks build) in v1.3.
  Reading the pack's `manifest.json` from its CurseForge file would settle this.
* ~~Sophisticated Backpacks' packet and storage classes were described from memory.~~ Now read
  (**verified**) from `P3pp3rF1y/SophisticatedBackpacks`, branch `1.20.x`,
  `src/main/java/net/p3pp3rf1y/sophisticatedbackpacks/`:
  * `backpack/BackpackStorage` extends `SavedData`; `Map<UUID, CompoundTag> backpackContents`
    on the server, a static `clientStorageCopy` on the client that is cleared on world load.
  * `network/BackpackContentsMessage` (server -> client) fills the client copy and refreshes the
    tooltip. `network/RequestBackpackInventoryContentsMessage(UUID, ItemStackReference)`
    (client -> server) answers with the `Inventory` and upgrade NBT for a backpack the player
    holds, in a container slot or an equipment handler slot. This is how the hover tooltip gets
    contents **without opening** the backpack.
  * `network/BackpackOpenMessage(int slot, String identifier, String handlerName)` opens a
    backpack from any player inventory handler (Curios included); with no handler it opens the
    first backpack found. Server side it calls `NetworkHooks.openScreen` with a `BackpackContainer`.
  * Not yet read: `ItemStackReference` (Sophisticated Core) and `PlayerInventoryProvider`, which
    define the handler/identifier strings for the Curios slot.
* **Polymorph's behaviour** with the planned recipe when several recipes share a grid layout.
* **Server plugins' click rate limits**: no vanilla or Forge limit was found; Paper-style servers are
  out of scope for a Forge pack but a "Packet spam" kick is the thing to watch for.
* **In-game test.** The jar builds and the dev client was launched: the log shows "CraftChain
  client hooks registered", "Backend library: LWJGL version 3.3.1 build 7", and JEI sending its
  config manager to `craftchain:jei_plugin`, with no errors. No world was opened and no craft was
  run. Doing that is the next step. Curios had to be taken off the dev runtime classpath (its
  mixin `AccessorEntity` fails to apply against the deobfuscated dev client); this does not
  affect the real pack.
* Two of the four research agents hit a usage limit mid-way; their questions were answered by
  reading the decompiled sources and the CurseForge pages directly instead.
