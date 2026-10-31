# CraftChain: design outline

Client-side Forge mod for Minecraft 1.20.1 (Forge 47.4.2, Java 17) that turns "I want this item"
into the clicks a player would make to craft it, intermediates included, from what they carry.
Target pack: MC Eternal 2 v1.3. Nothing is installed on the server.

## 1. What the player does

| Action | Where | Result |
|---|---|---|
| Hover an item in JEI (list, bookmarks or recipe screen) or in an inventory slot, press **G** | Inventory or crafting-table screen open | CraftChain plans the chain, then crafts 1 of the item. **Shift+G** crafts a full stack. |
| Press **P** on a hovered item | Any screen with JEI | Pins the item (+1). **Shift+P** adds a stack. **Ctrl+P** unpins. |
| Look at the top-left corner | In the world | The pinned list: each item, how many, and the raw materials it breaks down into, with have/need counts coloured green or red. |
| Press **Esc** while a craft runs | Crafting screen | Stops, returning anything still in the grid to the inventory. |
| `/craftchain clear`, `/craftchain cancel`, `/craftchain status` | Chat | Housekeeping. |

Keys are rebindable under Controls > CraftChain. They only apply while a screen is open, so they
cannot clash with movement keys. Chat tells the player what happened ("Missing: 12x Oak Log",
"One of the recipes needs a 3x3 grid: open a crafting table", and so on).

## 2. How it works

```
JEI overlay ──hover──► JeiHover ──ItemStack──► CraftPlanner ──CraftPlan──► CraftExecutor ──clicks──► server
                                                   ▲                                         (vanilla packets)
                                     RecipeIndex (client's synced recipes)
```

### 2.1 Finding the hovered item (`jei/`)

A `@JeiPlugin` class receives the `IJeiRuntime` when JEI starts. On a key press we ask, in order:
the ingredient list overlay, the bookmark overlay, the recipe screen, then the container screen's
slot under the mouse. All of these are JEI 9-era APIs, so any JEI 15.x in the pack works.

The key is read from Forge's `ScreenEvent.KeyPressed.Pre` at HIGH priority, which runs before JEI's
own handler. If JEI's search box or any text field has focus, the key is left alone.

### 2.2 Recipes (`planning/RecipeIndex`)

The server sends every recipe to the client on login and on `/reload`. The index maps result item
to the crafting-table recipes that make it, and caches which items each ingredient accepts. Only
`RecipeType.CRAFTING` is indexed, and "special" recipes (fireworks, map cloning, dyeing) are skipped:
those are the only recipes we can run by filling a grid. Smelting, Create pressing, Tinkers casting,
AE2 inscribing and the like are deliberately left out, so their outputs show up as raw materials.

Hidden JEI recipes and KubeJS-removed recipes: KubeJS removals never reach the client, so they are
simply absent. JEI's "hidden" flag is JEI-only; the planner may pick a recipe JEI hides. If that
becomes a problem, switch the index to JEI's `IRecipeManager.createRecipeLookup(RecipeTypes.CRAFTING)`.

### 2.3 Planning (`planning/CraftPlanner`)

Depth-first: take what the inventory has, pick a recipe for the rest, plan each ingredient first,
then append the recipe. Steps therefore come out in execution order.

* **Ingredient alternatives** (a tag like `#planks`): prefer the item the player holds the most of,
  then anything craftable, then the recipe's first option.
* **Multiple recipes** for an item: up to 3 are tried on a copy of the state and the one that leaves
  the fewest missing raw materials wins. A work budget (20 000 expansions) keeps it bounded; past
  that it goes greedy.
* **Cycles**: an item being expanded higher in the chain is never expanded again. Compression pairs
  (ingot <-> block, ingot <-> nugget) are only used when the input is already on hand. So the
  planner will uncraft iron blocks you carry, but it will never "need 9 nuggets" for an ingot.
* **Output**: ordered steps, a map of missing raw materials, and a flag for "a recipe needs 3x3 but
  you only have the 2x2 grid open".

The same planner with an empty inventory gives the **raw-material breakdown** for the pinned list.
64 ladders -> 22 ladder crafts -> 154 sticks -> 39 stick crafts -> 78 planks -> 20 plank crafts ->
20 logs. (Whichever log type the recipe lists first is shown; see "known gaps".)

### 2.4 Execution (`execution/CraftExecutor`)

The executor is a state machine advanced once per client tick. It uses exactly one vanilla method:
`MultiPlayerGameMode.handleInventoryMouseClick`, which updates the client's copy of the menu and
sends a `ServerboundContainerClickPacket`. The server does the real crafting and corrects the
client if they disagree. This is why no server mod is needed and why it works on any server that
runs vanilla crafting.

Per recipe step, in batches of up to one stack per grid slot:

1. **FILL** – for each grid slot: pick up a stack of the right item (left click), place the whole
   stack if it fits the batch (left click), otherwise place one at a time (right click). Up to
   `clicksPerTick` (default 6) clicks per tick. Wrong items in the grid are shift-clicked out first.
2. **CRAFT** – once the result slot shows an item, shift-click it. Vanilla's shift-click loops and
   crafts as many times as the grid allows, so a batch of N items per slot gives exactly N crafts.
3. **VERIFY** – wait `ticksAfterCraft` (default 3) then require an empty grid. If not empty
   (inventory full, recipe mismatch, server lag), unload the grid and stop with a message.

**Server safety.** Every click is a packet, so the executor paces itself:

* Separate speed settings for singleplayer and multiplayer, picked automatically
  (`Minecraft.hasSingleplayerServer()`). Multiplayer defaults: 1 click per tick (20/s, about what a
  fast human manages), 8 ticks after each craft, 5 ticks between batches. Singleplayer: 6 clicks
  per tick, 3 ticks, no pause.
* A hard cap on crafts per run (`crafting.maxCraftsPerRun`, default 128). Bigger plans are refused
  with a message instead of started.
* A built-in brake: the client never fills the result slot itself (recipe matching runs on the
  server only), so each batch waits for the server to answer before the shift-click goes out.
  A lagging server slows the mod down rather than the mod piling up packets.
* Every decision reads the live menu, which the server corrects if it disagrees, and anything
  unexpected (grid not empty, no result, inventory full, screen closed) stops the run.

Supported menus: the player's own 2x2 grid (`InventoryMenu`, always open behind the inventory
screen) and a vanilla crafting table (`CraftingMenu`). Slot numbers for both are in `GridLayout`.
If a step needs 3x3 and only the inventory is open, the player is told to open a table.

Why clicks and not the recipe book's "auto-place" packet: `ServerPlaceRecipe.recipeClicked`
(decompiled 1.20.1 source, verified) refuses any recipe the player's recipe book has not unlocked,
and MC Eternal 2 ships "Not Enough Recipe Book", which hides that book. Clicks have no such gate.

Why not JEI's own "+" button: JEI's transfer handler sends JEI's packet and fails with "JEI is not
on the server" when it is absent (see `BasicRecipeTransferHandler`). It also only fills one recipe.

### 2.5 Pinned list (`pins/`)

`PinnedList` holds item + count, saved to `config/craftchain-pins.json`. The raw breakdown is
cached per entry and recomputed when the count changes or recipes reload. `PinnedOverlay` is a
Forge GUI overlay (registered above all vanilla elements) that draws the list each frame; the
have/need numbers come from the inventory every frame, which is cheap.

## 3. Phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Skeleton builds against Forge 47.4.2 + JEI + Curios API; dev client (`runClient`) loads the mod next to JEI 15 on LWJGL 3.3.1 and JEI registers the plugin | done |
| 1 | JEI hook, planner, executor for 2x2 and 3x3, chat feedback, keybinds, config | code written, compiles, loads; **no craft run in-game yet** |
| 2 | Pinned list with raw-material breakdown and HUD, persistence, `/craftchain` commands | code written, compiles, loads; **not yet exercised in-game** |
| 3 | Backpacks (below) | researched, not started |
| 4 | Polish: drag-split to cut click count, "craft pinned amount" key, consume `getRemainingItems` (buckets), handle JEI-hidden recipes | not started |

## 4. Phase 3: backpacks

Facts, read from the Sophisticated Backpacks `1.20.x` source on GitHub (see RESEARCH.md):

* MC Eternal 2 ships **Sophisticated Backpacks** + **Sophisticated Core**, and **Curios API**. The
  "backpack slot" is Curios' `back` slot. Also present: Sophisticated Storage, Dank Storage, Luggage.
* Backpack contents live **on the server** in `BackpackStorage` (world saved data), keyed by a
  UUID in the item's NBT. The client keeps an empty copy that is filled only when the server sends
  `BackpackContentsMessage`.
* The client **can ask for a backpack's contents without opening it**: `RequestBackpackInventory-
  ContentsMessage(uuid, ItemStackReference)` is what the mod sends for its hover tooltip, and the
  server replies with the inventory NBT. The reference can point at a container slot or at an
  equipment handler + identifier + slot, which covers the Curios back slot.
* **Taking items out needs the backpack screen.** `BackpackOpenMessage(slot, identifier,
  handlerName)` makes the server open any backpack the player has, including the Curios one. The
  resulting `BackpackContainer` is an ordinary menu, so shift-clicking items out of it is the
  same `handleInventoryMouseClick` the executor already uses.
* Both sides of the pack have the mod, so our client can send those messages on the mod's own
  channel once we compile against its jar (CurseMaven coordinates are in RESEARCH.md).

Plan:

1. **See inside.** On demand (and on a slow timer), send a contents request for every backpack
   in the inventory and in the Curios slot; cache the answers per backpack UUID. The planner then
   counts those items as "available after a fetch". No screens open for this step.
2. **Fetch.** When a plan needs items from a backpack: send the open message for that backpack,
   wait for its screen, shift-click the needed stacks out (the backpack menu has its own slot
   layout, found from the menu's slot list at runtime), close it.
3. **Craft.** Reopen the crafting screen (the player's inventory can be reopened by the client;
   a crafting table needs a right-click on the block the player is looking at, via
   `MultiPlayerGameMode.useItemOn`) and run the existing executor.
4. All of this is one bigger state machine; the executor's phase design is meant to grow into it.

Open questions: whether the "Inventory Interaction" and "Pickup/Deposit" upgrades move items
while we work; how the mod names the Curios handler/identifier in `ItemStackReference`; how many
contents requests per second are polite.

## 5. Known gaps and risks

* **No craft has been run in-game yet.** The code compiles against the real Forge, JEI and Curios
  jars, and the dev client starts with the mod and JEI loaded (no errors, JEI registers the
  plugin), but no world was opened. First test: `gradlew runClient`, new creative world, craft
  sticks from planks in the 2x2, then ladders in a table. Then install the jar in the pack.
* **Curios is compile-only in the dev client.** Its runtime jar's mixins reference obfuscated
  names and crash `runClient`; the real pack is unaffected. Test the Curios slot in the pack.
* **Packet volume.** Placing N items one at a time costs N clicks. 64 per slot x 9 slots is ~600
  packets; at the multiplayer default of 1 click per tick that is ~30 seconds for a full stack of
  a 9-ingredient item. Vanilla and Forge do not rate-limit container clicks, but some server
  plugins do, hence the conservative defaults. Phase 4's drag-split (one `QUICK_CRAFT` drag
  distributes a carried stack evenly over several slots) cuts this to a handful of packets.
* **Full inventory.** Vanilla's crafting-result shift-click drops overflow on the ground
  (`CraftingMenu.quickMoveStack`, line ~150). The executor stops when the grid does not empty,
  but one dropped stack is possible before it notices.
* **Recipe choice** uses the client's recipe list, not JEI's view of it. Polymorph (in the pack)
  lets the server pick among conflicting recipes for the same grid contents; the planner fills the
  grid for a specific recipe, and the server may craft a different conflicting recipe's output.
  Rare for vanilla items, worth watching for pack-added ones.
* **Container-returning ingredients** (buckets, bottles) are not credited back.
* **Tags with many options**: the raw list shows whichever log/plank the recipe lists first when
  the player holds none. A better display would say "any log".
* **NBT-sensitive items** are matched by item only.
* **Mods that replace the vanilla crafting screen** (Crafting Tweaks adds buttons but keeps the
  menu; Crafting on a stick and Table Top Craft open their own menus) are not driven; use a real
  crafting table.
* **Keybind clashes**: G and P are unused by vanilla in GUIs. Sophisticated Backpacks uses B,
  JEI uses R/U/A/etc., Inventory sorting mods use middle click. Change them in Controls if needed.
