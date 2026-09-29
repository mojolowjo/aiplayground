# Benchmark report: 2026-09-29-mod-stack

- Minecraft 26.3, Java 25.0.4.1+1-1-24.04.4-Ubuntu (Ubuntu)
- 4 CPUs, 4096 MB max heap, GC: G1 Young Generation, G1 Concurrent GC, G1 Old Generation
- Baseline for comparisons: `lithium`
- MSPT = milliseconds of work per server tick (lower is better; 50 is the limit).
  Numbers are the average over runs, with the lowest and highest run in brackets.

## Startup

Seconds from launching Java to the server being ready, including creating a fresh
world. Averaged over every run of every scenario.

| Stack | Runs | Launch to ready (s) |
|---|---|---|
| `lithium` | 18 | 24.4 (21.8–32.8) |
| `lithium-ferrite` | 18 | 24.2 (22.1–30.1) |
| `lithium-ferrite-c2me-lux` | 18 | 24.3 (22.5–26.9) |
| `lithium-ferrite-moonrise` | 18 | 25.1 (23.0–29.4) |

## idle

An empty platform: the cost of the server doing nothing.

| Stack | Runs | MSPT mean | median | p95 | p99 | max | GC ms | vs baseline |
|---|---|---|---|---|---|---|---|---|
| `lithium` | 3 | 0.38 (0.33–0.40) | 0.34 (0.28–0.38) | 0.57 (0.51–0.60) | 0.92 (0.81–0.99) | 6.35 (3.88–11.21) | 0 (0–0) |  |
| `lithium-ferrite` | 3 | 0.37 (0.33–0.43) | 0.33 (0.29–0.40) | 0.59 (0.53–0.63) | 1.02 (0.74–1.17) | 5.64 (4.21–6.60) | 0 (0–0) | -0.5% |
| `lithium-ferrite-c2me-lux` | 3 | 0.39 (0.38–0.41) | 0.34 (0.31–0.35) | 0.64 (0.61–0.68) | 1.31 (0.88–1.81) | 4.53 (3.34–6.13) | 0 (0–0) | +4.4% |
| `lithium-ferrite-moonrise` | 3 | 0.28 (0.26–0.32) | 0.26 (0.23–0.29) | 0.45 (0.41–0.50) | 0.68 (0.64–0.73) | 4.48 (3.80–5.16) | 0 (0–0) | -24.5% |

| Stack | heap after GC (MB) |
|---|---|
| `lithium` | 176.33 (176.00–177.00) |
| `lithium-ferrite` | 168.33 (168.00–169.00) |
| `lithium-ferrite-c2me-lux` | 184.33 (183.00–186.00) |
| `lithium-ferrite-moonrise` | 263.00 (263.00–263.00) |

<details><summary>Hot methods: <code>lithium</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.level.chunk.LevelChunkSection.isRandomlyTickingFluids()                                                                           3   6.67%
net.minecraft.server.level.ServerLevel.advanceWeatherCycle()                                                                                          2   4.44%
net.minecraft.server.level.ChunkHolder.getTickingChunk()                                                                                              2   4.44%
net.minecraft.server.ServerFunctionLibrary.getTag(Identifier)                                                                                         2   4.44%
net.minecraft.util.profiling.Profiler.wrapMethod$bdo000$lithium$getProfiler(Operation)                                                                2   4.44%
net.minecraft.server.MinecraftServer.tickChildren(BooleanSupplier)                                                                                    2   4.44%
net.minecraft.util.Util.getNanos()                                                                                                                    2   4.44%
net.minecraft.server.level.ChunkMap$$Lambda.0x00000000671a6000.accept(Object)                                                                         2   4.44%
java.lang.invoke.DelegatingMethodHandle$Holder.delegate(Object, Object, Object)                                                                       1   2.22%
io.netty.util.internal.shaded.org.jctools.queues.atomic.BaseMpscLinkedAtomicArrayQueue.poll()                                                         1   2.22%
jdk.jfr.internal.event.EventWriter.putLong(long)                                                                                                      1   2.22%
net.minecraft.world.level.chunk.LevelChunkSection.lithium$getSectionData()                                                                            1   2.22%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.level.chunk.LevelChunkSection.isRandomlyTickingFluids()                                                                           2   4.00%
net.minecraft.server.MinecraftServer.runServer()                                                                                                      2   4.00%
net.minecraft.world.level.gamerules.GameRuleMap.get(GameRule)                                                                                         2   4.00%
net.minecraft.server.level.ServerLevel.tick(BooleanSupplier)                                                                                          2   4.00%
net.minecraft.server.level.ServerLevel.tickTime()                                                                                                     1   2.00%
java.lang.invoke.DelegatingMethodHandle$Holder.delegate(Object, Object, Object)                                                                       1   2.00%
net.minecraft.server.network.ServerConnectionListener.addPendingConnections()                                                                         1   2.00%
net.minecraft.server.level.ServerLevel.modifyExpressionValue$bhj000$lithium$lithiumRandomTick(int, LevelChunkSection, int, int, int, int)             1   2.00%
it.unimi.dsi.fastutil.objects.Object2BooleanOpenHashMap$MapIterator.hasNext()                                                                         1   2.00%
net.minecraft.server.level.ChunkMap.saveChunksEagerly(BooleanSupplier)                                                                                1   2.00%
net.minecraft.world.level.chunk.LevelChunkSection.lithium$getSectionData()                                                                            1   2.00%
java.lang.invoke.DirectMethodHandle.allocateInstance(Object)                                                                                          1   2.00%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite-c2me-lux</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.server.MinecraftServer.runServer()                                                                                                      3   5.36%
net.minecraft.server.level.ServerLevel.tick(BooleanSupplier)                                                                                          2   3.57%
java.lang.invoke.DirectMethodHandle.allocateInstance(Object)                                                                                          2   3.57%
net.minecraft.world.level.TicketStorage.removeTicketIf(TicketStorage$TicketPredicate, Long2ObjectOpenHashMap)                                         2   3.57%
it.unimi.dsi.fastutil.objects.Object2IntOpenHashMap.<init>()                                                                                          2   3.57%
net.minecraft.server.MinecraftServer.tickChildren(BooleanSupplier)                                                                                    2   3.57%
net.minecraft.server.level.ServerChunkCache.lambda$tickChunks$0(int, LevelChunk)                                                                      2   3.57%
net.minecraft.util.profiling.Profiler.wrapMethod$bjp000$lithium$getProfiler(Operation)                                                                2   3.57%
net.minecraft.world.level.chunk.LevelChunkSection.isRandomlyTickingFluids()                                                                           2   3.57%
net.minecraft.world.level.entity.EntitySectionStorage$Anonymous$8bd463eeb1493ce79f3e2caef1941c86.computeNext()                                        1   1.79%
net.minecraft.world.level.block.LiquidBlock.randomTick(BlockState, ServerLevel, BlockPos, RandomSource)                                               1   1.79%
net.minecraft.server.level.ServerChunkCache$MainThreadExecutor.pollTask()                                                                             1   1.79%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite-moonrise</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
ca.spottedleaf.moonrise.fabric.FabricHooks.configFixMC224294()                                                                                        3   5.66%
net.minecraft.server.MinecraftServer.tickChildren(BooleanSupplier)                                                                                    3   5.66%
net.minecraft.server.MinecraftServer.getAllLevels()                                                                                                   2   3.77%
net.minecraft.util.KeyframeTrackSampler.getSegmentAt(long)                                                                                            2   3.77%
net.minecraft.server.level.ServerChunkCache.tickChunks(ProfilerFiller)                                                                                2   3.77%
net.minecraft.server.level.ServerLevel.tick(BooleanSupplier)                                                                                          2   3.77%
net.minecraft.world.level.Level.getThunderLevel(float)                                                                                                1   1.89%
java.lang.String.getBytes(byte[], int, byte)                                                                                                          1   1.89%
net.minecraft.server.level.ServerLevel.tickTime()                                                                                                     1   1.89%
net.minecraft.server.players.PlayerList.getPlayerCount()                                                                                              1   1.89%
java.lang.invoke.DirectMethodHandle.allocateInstance(Object)                                                                                          1   1.89%
jdk.internal.classfile.impl.AttributeHolder.withAttribute(Attribute)                                                                                  1   1.89%
```

</details>

## villagers

300 villagers in one-block trading cells, each beside a workstation.

| Stack | Runs | MSPT mean | median | p95 | p99 | max | GC ms | vs baseline |
|---|---|---|---|---|---|---|---|---|
| `lithium` | 3 | 21.85 (16.60–31.14) | 21.78 (14.46–35.14) | 40.74 (23.94–59.97) | 48.09 (28.69–70.28) | 210.68 (52.87–302.65) | 319 (32–507) |  |
| `lithium-ferrite` | 3 | 27.58 (16.01–34.53) | 29.44 (14.62–37.62) | 49.20 (22.70–64.99) | 58.93 (28.22–76.02) | 152.49 (125.70–175.29) | 132 (127–138) | +26.2% |
| `lithium-ferrite-c2me-lux` | 3 | 16.68 (14.94–19.32) | 14.52 (13.57–16.05) | 27.69 (21.50–38.98) | 36.95 (26.11–50.84) | 238.46 (34.27–622.21) | 206 (0–611) | -23.7% |
| `lithium-ferrite-moonrise` | 3 | 24.76 (23.07–27.03) | 21.96 (20.74–22.84) | 40.71 (34.44–52.21) | 53.40 (41.46–67.32) | 124.33 (111.27–148.50) | 114 (104–121) | +13.3% |

| Stack | villagersAtEnd | heap after GC (MB) |
|---|---|---|
| `lithium` | 300.00 (300.00–300.00) | 196.00 (195.00–197.00) |
| `lithium-ferrite` | 300.00 (300.00–300.00) | 188.00 (188.00–188.00) |
| `lithium-ferrite-c2me-lux` | 300.00 (300.00–300.00) | 204.67 (204.00–205.00) |
| `lithium-ferrite-moonrise` | 300.00 (300.00–300.00) | 283.00 (283.00–283.00) |

<details><summary>Hot methods: <code>lithium</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
java.util.HashMap.getNode(Object)                                                                                                                   315   9.11%
net.minecraft.network.syncher.SynchedEntityData.getItem(EntityDataAccessor)                                                                         255   7.37%
it.unimi.dsi.fastutil.objects.Reference2ObjectOpenHashMap.get(Object)                                                                               241   6.97%
java.util.stream.AbstractPipeline.copyIntoWithCancel(Sink, Spliterator)                                                                             180   5.20%
net.minecraft.world.entity.ai.behavior.declarative.BehaviorBuilder$PureMemory$1.tryTrigger(ServerLevel, LivingEntity, long)                         159   4.60%
net.minecraft.world.entity.ai.Brain.startEachNonRunningBehavior(ServerLevel, LivingEntity)                                                          122   3.53%
net.minecraft.world.phys.shapes.Shapes.create(AABB)                                                                                                  99   2.86%
net.minecraft.server.level.ServerChunkCache.getChunk(int, int, ChunkStatus, boolean)                                                                 77   2.23%
java.lang.invoke.DirectMethodHandle.allocateInstance(Object)                                                                                         76   2.20%
net.minecraft.world.entity.ai.behavior.declarative.MemoryCondition$Present.createAccessor(Brain, Optional)                                           74   2.14%
java.util.stream.ReferencePipeline$2$1.accept(Object)                                                                                                68   1.97%
net.minecraft.world.entity.ai.behavior.declarative.MemoryCondition$Registered.createAccessor(Brain, Optional)                                        61   1.76%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
it.unimi.dsi.fastutil.objects.Reference2ObjectOpenHashMap.get(Object)                                                                               258  14.49%
net.minecraft.network.syncher.SynchedEntityData.getItem(EntityDataAccessor)                                                                         157   8.82%
net.minecraft.world.entity.ai.Brain.startEachNonRunningBehavior(ServerLevel, LivingEntity)                                                           99   5.56%
java.util.stream.ReferencePipeline$2$1.accept(Object)                                                                                                78   4.38%
net.minecraft.world.entity.ai.behavior.declarative.BehaviorBuilder$PureMemory$1.tryTrigger(ServerLevel, LivingEntity, long)                          66   3.71%
net.minecraft.world.entity.ai.behavior.SetLookAndInteract.lambda$create$3(LivingEntity, int, EntityType, LivingEntity)                               57   3.20%
it.unimi.dsi.fastutil.objects.Object2IntOpenHashMap.getInt(Object)                                                                                   45   2.53%
java.util.ArrayList$ArrayListSpliterator.forEachRemaining(Consumer)                                                                                  31   1.74%
java.util.ArrayList.forEach(Consumer)                                                                                                                30   1.69%
net.minecraft.world.entity.ai.behavior.GateBehavior.doStop(ServerLevel, LivingEntity, long)                                                          29   1.63%
net.minecraft.world.level.entity.EntitySection.lithium$collectPushableEntities(Level, Entity, AABB, EntityPushablePredicate, ArrayList)              29   1.63%
net.minecraft.server.level.ServerChunkCache.getChunk(int, int, ChunkStatus, boolean)                                                                 25   1.40%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite-c2me-lux</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
java.lang.invoke.LambdaForm$MH.0x000000008f3ae800.invoke(Object, Object, Object)                                                                    215  12.98%
net.minecraft.world.entity.ai.Brain.startEachNonRunningBehavior(ServerLevel, LivingEntity)                                                          143   8.64%
net.minecraft.network.syncher.SynchedEntityData.getItem(EntityDataAccessor)                                                                         133   8.03%
java.util.stream.ReferencePipeline$2$1.accept(Object)                                                                                                82   4.95%
net.minecraft.world.entity.ai.behavior.declarative.BehaviorBuilder$PureMemory$1.tryTrigger(ServerLevel, LivingEntity, long)                          66   3.99%
net.minecraft.world.entity.ai.behavior.GateBehavior.tickOrStop(ServerLevel, LivingEntity, long)                                                      38   2.29%
it.unimi.dsi.fastutil.objects.Object2IntOpenHashMap.getInt(Object)                                                                                   34   2.05%
java.util.stream.ReferencePipeline$3$1.accept(Object)                                                                                                33   1.99%
net.minecraft.world.entity.ai.Brain.tickSensors(ServerLevel, LivingEntity)                                                                           29   1.75%
net.minecraft.server.level.ServerChunkCache.getChunk$mixinextras$wrapped$94(int, int, ChunkStatus, boolean)                                          25   1.51%
java.util.ArrayList.forEach(Consumer)                                                                                                                25   1.51%
net.minecraft.world.entity.ai.behavior.SetLookAndInteract.lambda$create$3(LivingEntity, int, EntityType, LivingEntity)                               25   1.51%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite-moonrise</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
ca.spottedleaf.moonrise.patches.poi_lookup.PoiAccess.findNearestPoiRecords(...)                                                                     368  12.12%
it.unimi.dsi.fastutil.longs.LongOpenHashSet.rehash(int)                                                                                             334  11.00%
it.unimi.dsi.fastutil.longs.LongOpenHashSet.add(long)                                                                                               235   7.74%
java.lang.invoke.LambdaForm$MH.0x000000000835e800.invoke(Object, Object, Object)                                                                    156   5.14%
it.unimi.dsi.fastutil.objects.Reference2ObjectOpenHashMap.get(Object)                                                                               145   4.78%
net.minecraft.world.entity.Entity.isRemoved()                                                                                                       122   4.02%
it.unimi.dsi.fastutil.longs.LongArrayFIFOQueue.enqueue(long)                                                                                        114   3.75%
net.minecraft.world.entity.ai.Brain.startEachNonRunningBehavior(ServerLevel, LivingEntity)                                                          104   3.43%
net.minecraft.world.entity.ai.behavior.declarative.BehaviorBuilder$PureMemory$1.tryTrigger(ServerLevel, LivingEntity, long)                          77   2.54%
java.util.stream.ReferencePipeline$2$1.accept(Object)                                                                                                58   1.91%
net.minecraft.world.entity.ai.behavior.SetLookAndInteract.lambda$create$3(LivingEntity, int, EntityType, LivingEntity)                               49   1.61%
java.util.HashMap.getNode(Object)                                                                                                                    41   1.35%
```

</details>

## cramming

200 cows packed into a 5x5 pen.

| Stack | Runs | MSPT mean | median | p95 | p99 | max | GC ms | vs baseline |
|---|---|---|---|---|---|---|---|---|
| `lithium` | 3 | 4.74 (4.52–4.93) | 4.15 (3.97–4.31) | 7.49 (7.05–7.92) | 10.67 (9.38–11.66) | 59.23 (36.21–75.81) | 40 (19–70) |  |
| `lithium-ferrite` | 3 | 6.53 (4.43–7.80) | 5.28 (3.85–6.37) | 12.93 (6.52–16.57) | 16.13 (9.22–20.26) | 37.67 (30.23–49.34) | 10 (0–29) | +37.8% |
| `lithium-ferrite-c2me-lux` | 3 | 8.74 (6.91–12.21) | 6.90 (4.08–11.66) | 17.32 (16.01–19.68) | 22.68 (20.82–26.16) | 391.60 (341.59–450.70) | 382 (333–441) | +84.2% |
| `lithium-ferrite-moonrise` | 3 | 4.32 (3.85–4.80) | 3.84 (3.42–4.33) | 6.66 (6.02–7.33) | 8.84 (7.83–9.48) | 23.82 (13.61–31.73) | 7 (0–21) | -8.8% |

| Stack | cowsAtEnd | heap after GC (MB) |
|---|---|---|
| `lithium` | 200.00 (200.00–200.00) | 179.00 (179.00–179.00) |
| `lithium-ferrite` | 200.00 (200.00–200.00) | 171.00 (171.00–171.00) |
| `lithium-ferrite-c2me-lux` | 200.00 (200.00–200.00) | 187.00 (186.00–188.00) |
| `lithium-ferrite-moonrise` | 200.00 (200.00–200.00) | 266.00 (266.00–266.00) |

<details><summary>Hot methods: <code>lithium</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.entity.EntitySelector$$Lambda.0x000000003328dd08.test(Object)                                                                    81  16.23%
net.minecraft.core.TypedInstance.is(TagKey)                                                                                                          28   5.61%
net.minecraft.world.entity.Entity.push(Entity)                                                                                                       19   3.81%
it.unimi.dsi.fastutil.longs.Long2ByteOpenHashMap.get(long)                                                                                           19   3.81%
net.minecraft.world.entity.Mob.serverAiStep()                                                                                                        15   3.01%
java.util.ArrayList$Itr.hasNext()                                                                                                                    15   3.01%
java.util.ImmutableCollections$SetN.probe(Object)                                                                                                    15   3.01%
java.util.ArrayList$Itr.next()                                                                                                                       12   2.40%
com.google.common.collect.Iterators$1.hasNext()                                                                                                      11   2.20%
net.minecraft.world.level.block.state.BlockBehaviour$BlockStateBase.getCollisionShape(BlockGetter, BlockPos, CollisionContext)                        9   1.80%
net.minecraft.server.level.ServerChunkCache.getChunk(int, int, ChunkStatus, boolean)                                                                  9   1.80%
net.minecraft.world.level.biome.BiomeManager.getBiome(int, int, int)                                                                                  9   1.80%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.entity.EntitySelector.lambda$pushableBy$0(Entity, Team, Team$CollisionRule, Entity)                                             117  13.67%
java.util.Arrays.copyOf(Object[], int)                                                                                                               55   6.43%
net.minecraft.world.entity.LivingEntity.onClimbable()                                                                                                52   6.07%
java.util.stream.ReferencePipeline.anyMatch(Predicate)                                                                                               30   3.50%
net.minecraft.server.level.ServerChunkCache.getChunk(int, int, ChunkStatus, boolean)                                                                 28   3.27%
net.minecraft.world.phys.shapes.Shapes.create(AABB)                                                                                                  27   3.15%
it.unimi.dsi.fastutil.longs.Long2ObjectOpenHashMap.get(long)                                                                                         27   3.15%
net.minecraft.world.entity.Entity.push(Entity)                                                                                                       26   3.04%
java.util.ArrayList$Itr.next()                                                                                                                       21   2.45%
java.lang.invoke.LambdaForm$MH.0x000000005f352400.guard(Object, Object, Object)                                                                      20   2.34%
it.unimi.dsi.fastutil.objects.Object2ObjectOpenHashMap.get(Object)                                                                                   20   2.34%
net.minecraft.world.level.block.state.BlockBehaviour$BlockStateBase.getCollisionShape(BlockGetter, BlockPos, CollisionContext)                       17   1.99%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite-c2me-lux</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
java.util.Arrays.copyOf(Object[], int)                                                                                                              162  12.33%
net.minecraft.world.entity.EntitySelector.lambda$pushableBy$0(Entity, Team, Team$CollisionRule, Entity)                                              84   6.39%
net.minecraft.world.phys.shapes.Shapes.create(AABB)                                                                                                  77   5.86%
net.minecraft.core.TypedInstance.is(TagKey)                                                                                                          59   4.49%
java.util.stream.AbstractPipeline.copyIntoWithCancel(Sink, Spliterator)                                                                              53   4.03%
net.minecraft.world.entity.Entity.lithium$CollideMovement(Entity, Vec3, AABB, Level, List, LocalBooleanRef)                                          48   3.65%
net.minecraft.world.phys.shapes.Shapes.create(double, double, double, double, double, double)                                                        44   3.35%
net.caffeinemc.mods.lithium.common.world.WorldHelper.getEntitiesOfEntityGroupWithoutDragonPieces(...)                                                34   2.59%
net.minecraft.world.level.BlockGetter.forEachBlockIntersectedBetween(Vec3, Vec3, AABB, BlockGetter$BlockStepVisitor)                                 32   2.44%
net.minecraft.world.level.Level.getBlockState(BlockPos)                                                                                              30   2.28%
it.unimi.dsi.fastutil.longs.Long2ObjectOpenHashMap.get(long)                                                                                         29   2.21%
net.minecraft.world.entity.Mob.serverAiStep()                                                                                                        29   2.21%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite-moonrise</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.core.TypedInstance.is(TagKey)                                                                                                         111  28.76%
net.minecraft.world.entity.LivingEntity.pushEntities()                                                                                               21   5.44%
java.lang.invoke.LambdaForm$MH.0x000000008935e400.guard(Object, Object, Object)                                                                      20   5.18%
net.minecraft.world.level.NaturalSpawner.createState(int, ServerLevel, NaturalSpawner$ChunkGetter, LocalMobCapCalculator)                            11   2.85%
net.minecraft.world.entity.EntitySelector.lambda$pushableBy$0(Entity, Team, Team$CollisionRule, Entity)                                              11   2.85%
net.minecraft.world.entity.Mob.serverAiStep()                                                                                                         8   2.07%
net.minecraft.world.entity.ai.goal.GoalSelector.tick()                                                                                                8   2.07%
net.minecraft.world.entity.Mob.aiStep()                                                                                                               8   2.07%
net.minecraft.world.level.block.state.BlockBehaviour$BlockStateBase.getCollisionShape(BlockGetter, BlockPos, CollisionContext)                        7   1.81%
net.minecraft.world.level.storage.DerivedLevelData.getGameTime()                                                                                      6   1.55%
net.minecraft.world.entity.Mob.tick()                                                                                                                 5   1.30%
java.util.HashMap.getNode(Object)                                                                                                                     5   1.30%
```

</details>

## items

1200 item entities of different types on a 16x16 floor.

| Stack | Runs | MSPT mean | median | p95 | p99 | max | GC ms | vs baseline |
|---|---|---|---|---|---|---|---|---|
| `lithium` | 3 | 10.47 (4.68–13.45) | 8.86 (4.07–15.65) | 22.19 (6.99–30.59) | 29.59 (9.53–43.24) | 85.45 (25.66–127.86) | 76 (17–118) |  |
| `lithium-ferrite` | 3 | 7.87 (4.71–14.07) | 5.35 (4.16–7.49) | 16.09 (6.97–34.01) | 22.29 (9.05–48.04) | 61.26 (41.52–97.41) | 54 (36–87) | -24.9% |
| `lithium-ferrite-c2me-lux` | 3 | 5.25 (5.09–5.41) | 4.56 (4.42–4.67) | 7.25 (7.02–7.57) | 10.17 (9.84–10.42) | 284.43 (203.64–327.96) | 341 (321–379) | -49.9% |
| `lithium-ferrite-moonrise` | 3 | 7.39 (5.68–10.09) | 5.96 (5.12–7.09) | 11.98 (8.30–19.04) | 18.54 (14.63–23.61) | 160.42 (43.64–304.28) | 139 (0–293) | -29.4% |

| Stack | itemsAtEnd | heap after GC (MB) |
|---|---|---|
| `lithium` | 1200.00 (1200.00–1200.00) | 181.33 (181.00–182.00) |
| `lithium-ferrite` | 1200.00 (1200.00–1200.00) | 173.00 (173.00–173.00) |
| `lithium-ferrite-c2me-lux` | 1200.00 (1200.00–1200.00) | 188.67 (188.00–189.00) |
| `lithium-ferrite-moonrise` | 1200.00 (1200.00–1200.00) | 267.33 (267.00–268.00) |

<details><summary>Hot methods: <code>lithium</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
it.unimi.dsi.fastutil.longs.Long2ByteOpenHashMap.get(long)                                                                                           55  11.16%
net.minecraft.world.entity.Entity.tick()                                                                                                             46   9.33%
net.minecraft.server.level.ServerChunkCache.getChunk(int, int, ChunkStatus, boolean)                                                                 43   8.72%
net.minecraft.server.level.ServerEntity.sendChanges()                                                                                                27   5.48%
net.minecraft.world.entity.Entity.checkInsideBlocks(List, InsideBlockEffectApplier$StepBasedCollector)                                               22   4.46%
net.caffeinemc.mods.lithium.common.entity.movement.ChunkAwareBlockCollisionSweeperVoxelShape.<init>(Level, Entity, AABB)                             22   4.46%
net.minecraft.core.component.DataComponentMap$Builder$SimpleMap.get(DataComponentType)                                                               20   4.06%
net.minecraft.world.entity.item.ItemEntity.tick()                                                                                                    18   3.65%
it.unimi.dsi.fastutil.objects.Reference2ObjectOpenHashMap.get(Object)                                                                                17   3.45%
net.minecraft.world.level.entity.EntitySectionStorage$Anonymous$8bd463eeb1493ce79f3e2caef1941c86.computeNext()                                       15   3.04%
net.minecraft.world.level.block.state.BlockBehaviour$BlockStateBase.getCollisionShape(BlockGetter, BlockPos, CollisionContext)                       14   2.84%
java.util.ImmutableCollections$SetN.probe(Object)                                                                                                    11   2.23%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.entity.Entity.tick()                                                                                                             57  11.47%
it.unimi.dsi.fastutil.longs.Long2ByteOpenHashMap.get(long)                                                                                           53  10.66%
net.minecraft.server.level.ServerChunkCache.getChunk(int, int, ChunkStatus, boolean)                                                                 39   7.85%
it.unimi.dsi.fastutil.objects.Reference2ObjectOpenHashMap.get(Object)                                                                                31   6.24%
net.caffeinemc.mods.lithium.common.entity.movement.ChunkAwareBlockCollisionSweeperVoxelShape.<init>(Level, Entity, AABB)                             29   5.84%
net.minecraft.server.level.ServerEntity.sendChanges()                                                                                                25   5.03%
net.minecraft.core.component.DataComponentMap$Builder$SimpleMap.get(DataComponentType)                                                               20   4.02%
net.minecraft.world.level.entity.EntitySectionStorage$Anonymous$8bd463eeb1493ce79f3e2caef1941c86.computeNext()                                       18   3.62%
java.util.HashMap.getNode(Object)                                                                                                                    13   2.62%
net.minecraft.world.level.entity.EntitySectionStorage.handler$bcf000$lithium$forEachInBox(...)                                                       12   2.41%
it.unimi.dsi.fastutil.objects.Reference2ObjectArrayMap$ValuesCollection.forEach(Consumer)                                                            10   2.01%
net.minecraft.server.MinecraftServer.runServer()                                                                                                      7   1.41%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite-c2me-lux</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.server.level.ServerChunkCache.getChunk$mixinextras$wrapped$94(int, int, ChunkStatus, boolean)                                          60  11.95%
net.minecraft.world.entity.Entity.tick()                                                                                                             48   9.56%
it.unimi.dsi.fastutil.longs.Long2ByteOpenHashMap.get(long)                                                                                           42   8.37%
net.minecraft.server.level.ServerEntity.sendChanges()                                                                                                36   7.17%
net.minecraft.core.component.DataComponentMap$Builder$SimpleMap.get(DataComponentType)                                                               22   4.38%
it.unimi.dsi.fastutil.objects.Reference2ObjectOpenHashMap.get(Object)                                                                                19   3.78%
com.google.common.collect.Iterators$1.hasNext()                                                                                                      18   3.59%
it.unimi.dsi.fastutil.objects.Reference2ObjectArrayMap$ValuesCollection.forEach(Consumer)                                                            17   3.39%
it.unimi.dsi.fastutil.longs.Long2ByteOpenHashMap.containsKey(long)                                                                                   16   3.19%
net.minecraft.world.level.block.state.BlockBehaviour$BlockStateBase.getCollisionShape(BlockGetter, BlockPos, CollisionContext)                       15   2.99%
net.minecraft.world.entity.item.ItemEntity.tick()                                                                                                    13   2.59%
net.minecraft.world.level.entity.EntitySectionStorage.handler$bic000$lithium$forEachInBox(...)                                                       12   2.39%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite-moonrise</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.entity.Entity.tick()                                                                                                             48   8.23%
net.minecraft.server.level.ChunkMap.redirect$bha000$moonrise$newTrackerTick(Iterator)                                                                46   7.89%
java.util.HashMap.getNode(Object)                                                                                                                    45   7.72%
net.minecraft.core.component.DataComponentMap$Builder$SimpleMap.get(DataComponentType)                                                               35   6.00%
net.minecraft.server.level.ServerEntity.sendChanges()                                                                                                30   5.15%
net.minecraft.server.level.ServerLevel.tickNonPassenger(Entity)                                                                                      29   4.97%
net.minecraft.world.entity.Entity$$Lambda.0x00000000832cfc88.visit(BlockPos, int)                                                                    23   3.95%
it.unimi.dsi.fastutil.objects.Reference2ObjectOpenHashMap.get(Object)                                                                                21   3.60%
net.minecraft.world.level.block.state.BlockBehaviour$BlockStateBase.getBlock()                                                                       21   3.60%
net.minecraft.world.entity.Entity.updateFluidInteraction()                                                                                           21   3.60%
net.minecraft.world.level.Level.noCollision(Entity, AABB)                                                                                            19   3.26%
net.minecraft.world.level.Level.moonrise$getHardCollidingEntities(Entity, AABB, Predicate)                                                           17   2.92%
```

</details>

## hoppers

50 chains of 20 hoppers (1000 total) moving items between barrels.

| Stack | Runs | MSPT mean | median | p95 | p99 | max | GC ms | vs baseline |
|---|---|---|---|---|---|---|---|---|
| `lithium` | 3 | 1.19 (1.16–1.22) | 1.06 (1.01–1.10) | 1.63 (1.59–1.69) | 3.98 (3.74–4.37) | 14.64 (14.37–15.15) | 0 (0–0) |  |
| `lithium-ferrite` | 3 | 1.31 (1.25–1.38) | 1.14 (1.10–1.20) | 1.84 (1.71–2.01) | 4.18 (3.88–4.58) | 57.31 (12.40–124.90) | 0 (0–0) | +10.4% |
| `lithium-ferrite-c2me-lux` | 3 | 1.38 (1.33–1.48) | 1.30 (1.25–1.38) | 1.98 (1.89–2.14) | 3.32 (2.97–3.73) | 7.06 (5.58–8.93) | 0 (0–0) | +16.3% |
| `lithium-ferrite-moonrise` | 3 | 1.09 (1.02–1.18) | 0.99 (0.95–1.07) | 1.58 (1.48–1.74) | 2.61 (2.03–3.47) | 11.56 (4.58–22.99) | 0 (0–0) | -8.5% |

| Stack | itemsDeliveredDuringMeasurement | heap after GC (MB) |
|---|---|---|
| `lithium` | 7500.00 (7500.00–7500.00) | 177.67 (177.00–178.00) |
| `lithium-ferrite` | 7500.00 (7500.00–7500.00) | 169.33 (169.00–170.00) |
| `lithium-ferrite-c2me-lux` | 7500.00 (7500.00–7500.00) | 185.67 (185.00–187.00) |
| `lithium-ferrite-moonrise` | 7500.00 (7500.00–7500.00) | 263.00 (263.00–263.00) |

<details><summary>Hot methods: <code>lithium</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.level.chunk.LevelChunk$RebindableTickingBlockEntityWrapper.isRemoved()                                                           22  14.97%
net.minecraft.world.level.chunk.LevelChunk$BoundTickingBlockEntity.isRemoved()                                                                       11   7.48%
it.unimi.dsi.fastutil.longs.Long2ByteOpenHashMap.get(long)                                                                                            8   5.44%
net.minecraft.world.level.block.entity.HopperBlockEntity.redirect$zpk000$lithium$lithiumHopperIsEmpty(HopperBlockEntity)                              6   4.08%
java.util.AbstractList$Itr.hasNext()                                                                                                                  6   4.08%
it.unimi.dsi.fastutil.longs.Long2ObjectLinkedOpenHashMap.get(long)                                                                                    4   2.72%
net.caffeinemc.mods.lithium.common.hopper.InventoryHelper.getLithiumStackList(LithiumInventory)                                                       4   2.72%
net.minecraft.server.MinecraftServer.runServer()                                                                                                      3   2.04%
net.minecraft.world.level.chunk.PalettedContainer.get(int)                                                                                            3   2.04%
net.minecraft.world.level.Level.updateNeighbourForOutputSignal(BlockPos, Block)                                                                       3   2.04%
net.minecraft.core.component.DataComponentMap$Builder$SimpleMap.get(DataComponentType)                                                                3   2.04%
net.minecraft.server.level.ChunkHolder.getTickingChunk()                                                                                              3   2.04%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.level.chunk.LevelChunk$RebindableTickingBlockEntityWrapper.isRemoved()                                                           18  12.24%
it.unimi.dsi.fastutil.longs.Long2ByteOpenHashMap.get(long)                                                                                           12   8.16%
net.minecraft.world.level.block.entity.HopperBlockEntity.ejectItems(Level, BlockPos, HopperBlockEntity)                                               8   5.44%
net.minecraft.world.level.chunk.LevelChunk$BoundTickingBlockEntity.isRemoved()                                                                        7   4.76%
net.caffeinemc.mods.lithium.common.hopper.HopperHelper.tryMoveSingleItem(Container, ItemStack, Direction)                                             6   4.08%
it.unimi.dsi.fastutil.longs.Long2ObjectLinkedOpenHashMap.get(long)                                                                                    5   3.40%
net.caffeinemc.mods.lithium.common.util.change_tracking.ChangeSubscriber.without(ChangeSubscriber, ChangeSubscriber, int, boolean)                    5   3.40%
net.minecraft.world.level.Level.updateNeighbourForOutputSignal(BlockPos, Block)                                                                       4   2.72%
net.minecraft.core.component.DataComponentMap$Builder$SimpleMap.get(DataComponentType)                                                                4   2.72%
it.unimi.dsi.fastutil.longs.Long2ObjectOpenHashMap.get(long)                                                                                          3   2.04%
net.minecraft.world.level.block.state.StateHolder.valueIndex(Property)                                                                                3   2.04%
net.minecraft.server.level.ChunkHolder.getTickingChunk()                                                                                              3   2.04%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite-c2me-lux</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.level.chunk.LevelChunk$RebindableTickingBlockEntityWrapper.isRemoved()                                                           22  15.07%
net.minecraft.world.level.chunk.LevelChunk$BoundTickingBlockEntity.isRemoved()                                                                       13   8.90%
net.minecraft.server.level.ServerLevel.shouldTickBlocksAt(long)                                                                                      10   6.85%
net.minecraft.world.level.chunk.PalettedContainer.get(int)                                                                                            7   4.79%
it.unimi.dsi.fastutil.longs.Long2IntFunctions$SynchronizedFunction.get(long)                                                                          6   4.11%
it.unimi.dsi.fastutil.objects.Object2ReferenceOpenHashMap.get(Object)                                                                                 5   3.42%
it.unimi.dsi.fastutil.longs.Long2ObjectOpenHashMap.get(long)                                                                                          4   2.74%
net.minecraft.core.component.DataComponentMap$Builder$SimpleMap.get(DataComponentType)                                                                4   2.74%
net.minecraft.world.level.block.entity.HopperBlockEntity.handler$bfl000$lithium$lithiumInsert(...)                                                    3   2.05%
net.minecraft.world.level.LevelAccessor.hasChunk(int, int)                                                                                            3   2.05%
java.util.ArrayList.iterator()                                                                                                                        3   2.05%
net.minecraft.server.MinecraftServer.runServer()                                                                                                      3   2.05%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite-moonrise</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.level.chunk.LevelChunk$BoundTickingBlockEntity.isRemoved()                                                                       14  10.85%
net.minecraft.world.level.chunk.LevelChunk$RebindableTickingBlockEntityWrapper.isRemoved()                                                           13  10.08%
java.util.HashMap.getNode(Object)                                                                                                                    10   7.75%
net.minecraft.world.level.Level.updateNeighbourForOutputSignal(BlockPos, Block)                                                                       7   5.43%
net.minecraft.world.level.chunk.LevelChunk$RebindableTickingBlockEntityWrapper.tick()                                                                 5   3.88%
net.minecraft.core.component.DataComponentMap$Builder$SimpleMap.get(DataComponentType)                                                                5   3.88%
it.unimi.dsi.fastutil.objects.Reference2ObjectOpenHashMap.get(Object)                                                                                 4   3.10%
net.minecraft.world.level.block.entity.BlockEntity.setChanged(Level, BlockPos, BlockState)                                                            3   2.33%
net.minecraft.server.MinecraftServer.runServer()                                                                                                      3   2.33%
net.minecraft.server.level.ServerChunkCache.runDistanceManagerUpdates()                                                                               3   2.33%
ca.spottedleaf.moonrise.libs.ca.spottedleaf.concurrentutil.map.concurrent.longs.ConcurrentChainedLong2ReferenceHashTable$EntryNodeIterator.h...       2   1.55%
net.minecraft.world.item.ItemStack.copy()                                                                                                             2   1.55%
```

</details>

## worldgen

Generate 625 new chunks (25x25) far from spawn.

| Stack | Runs | MSPT mean | median | p95 | p99 | max | GC ms | vs baseline |
|---|---|---|---|---|---|---|---|---|
| `lithium` | 3 | 5.86 (5.67–6.08) | 2.68 (2.50–2.84) | 22.82 (21.37–25.10) | 59.63 (55.23–63.28) | 223.39 (140.63–323.37) | 435 (270–608) |  |
| `lithium-ferrite` | 3 | 6.22 (6.03–6.48) | 2.74 (2.54–2.93) | 21.76 (19.54–25.43) | 57.75 (56.16–60.48) | 242.54 (183.55–301.05) | 447 (327–566) | +6.0% |
| `lithium-ferrite-c2me-lux` | 3 | 9.43 (8.93–10.28) | 7.09 (6.54–8.17) | 23.01 (21.21–26.03) | 51.52 (44.17–57.40) | 239.19 (166.63–381.59) | 851 (525–1105) | +60.8% |
| `lithium-ferrite-moonrise` | 3 | 3.25 (3.19–3.28) | 0.32 (0.31–0.33) | 7.88 (7.28–8.28) | 46.72 (44.92–48.40) | 358.37 (249.17–476.09) | 352 (331–371) | -44.7% |

| Stack | chunksReady | complete | seconds | chunksPerSecond | heap after GC (MB) |
|---|---|---|---|---|---|
| `lithium` | 625.00 (625.00–625.00) | True, True, True | 28.29 (23.73–30.58) | 22.41 (20.44–26.34) | 267.00 (264.00–269.00) |
| `lithium-ferrite` | 625.00 (625.00–625.00) | True, True, True | 29.69 (28.74–30.86) | 21.07 (20.25–21.74) | 255.33 (252.00–261.00) |
| `lithium-ferrite-c2me-lux` | 625.00 (625.00–625.00) | True, True, True | 22.83 (21.03–25.61) | 27.58 (24.40–29.71) | 279.00 (279.00–279.00) |
| `lithium-ferrite-moonrise` | 625.00 (625.00–625.00) | True, True, True | 41.40 (39.07–43.28) | 15.12 (14.44–16.00) | 371.00 (370.00–372.00) |

<details><summary>Hot methods: <code>lithium</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.level.levelgen.synth.GradientNoise.permute(int)                                                                                 390  10.73%
net.minecraft.world.level.levelgen.Aquifer$NoiseBasedAquifer.computeSubstance(int, int, int, double)                                                198   5.45%
net.minecraft.world.level.levelgen.material.rule.SequenceRule.lambda$compile$0(RuleEvaluator[], int, int, int)                                      160   4.40%
net.minecraft.world.level.levelgen.material.rule.ConditionRule.lambda$compile$0(ConditionEvaluator, RuleEvaluator, int, int, int)                   159   4.37%
net.minecraft.world.level.levelgen.synth.PerlinNoise.addToVolume(DensityBuffer, DensityVolume, double, double, float)                               144   3.96%
net.minecraft.world.level.material.FluidState.isRandomlyTicking()                                                                                   119   3.27%
net.minecraft.world.level.levelgen.densityfunction.DensityVolume.indexOfBlock(int, int, int)                                                        110   3.03%
net.minecraft.world.level.levelgen.densityfunction.op.InterpolatedFunction$Sampler.fillCell(...)                                                    105   2.89%
net.minecraft.world.level.biome.Climate$RTree$SubTree.search(long[], Climate$RTree$Leaf, Climate$DistanceMetric)                                    101   2.78%
net.minecraft.world.level.levelgen.material.MaterialSystem.buildSurface(...)                                                                         85   2.34%
net.minecraft.world.level.levelgen.NoiseBasedChunkGenerator.doFill(NoiseChunk, ChunkAccess)                                                          79   2.17%
net.minecraft.world.level.biome.BiomeManager.getBiome(int, int, int)                                                                                 77   2.12%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.level.levelgen.synth.GradientNoise.permute(int)                                                                                 296   6.86%
net.minecraft.world.level.levelgen.Aquifer$NoiseBasedAquifer.computeSubstance(int, int, int, double)                                                224   5.19%
net.minecraft.world.level.levelgen.material.rule.SequenceRule.lambda$compile$0(RuleEvaluator[], int, int, int)                                      165   3.83%
net.minecraft.world.level.levelgen.material.rule.ConditionRule.lambda$compile$0(ConditionEvaluator, RuleEvaluator, int, int, int)                   141   3.27%
net.minecraft.world.level.levelgen.synth.PerlinNoise.addToVolume(DensityBuffer, DensityVolume, double, double, float)                               131   3.04%
net.minecraft.world.level.chunk.PalettedContainer.getAndSet(int, Object)                                                                            128   2.97%
net.minecraft.world.level.levelgen.densityfunction.DensityVolume.indexOfBlock(int, int, int)                                                        108   2.50%
net.minecraft.world.level.levelgen.material.MaterialRuleContext$LazyYCondition.test()                                                                90   2.09%
net.minecraft.world.level.biome.Climate$RTree$SubTree.search(long[], Climate$RTree$Leaf, Climate$DistanceMetric)                                     83   1.92%
java.util.stream.AbstractPipeline.copyIntoWithCancel(Sink, Spliterator)                                                                              77   1.79%
net.minecraft.world.level.biome.BiomeManager.getBiome(int, int, int)                                                                                 73   1.69%
net.minecraft.world.level.levelgen.densityfunction.op.InterpolatedFunction$Sampler.fillCell(...)                                                     72   1.67%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite-c2me-lux</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.level.levelgen.synth.NoiseStack$Perlin.addToVolume(DensityBuffer, DensityVolume, double, double, float)                         235   6.56%
net.minecraft.world.level.levelgen.material.rule.SequenceRule.lambda$compile$0(RuleEvaluator[], int, int, int)                                      170   4.75%
net.minecraft.world.level.chunk.LinearPalette.idFor(Object, PaletteResize)                                                                          150   4.19%
net.minecraft.server.level.WorldGenRegion.isWithinWriteZone(int, int)                                                                               117   3.27%
net.minecraft.world.level.chunk.PalettedContainer.get(int)                                                                                          108   3.02%
net.minecraft.world.level.levelgen.material.rule.OreVeinRule.lambda$compile$1(...)                                                                  102   2.85%
net.minecraft.world.level.levelgen.material.rule.ConditionRule.lambda$compile$0(ConditionEvaluator, RuleEvaluator, int, int, int)                   100   2.79%
net.minecraft.world.level.biome.Climate$RTree$SubTree.search(long[], Climate$RTree$Leaf, Climate$DistanceMetric)                                     91   2.54%
net.minecraft.world.level.levelgen.synth.NoiseStack$SmearedPerlin.addToVolume(DensityBuffer, DensityVolume, double, double, float)                   90   2.51%
net.minecraft.world.level.levelgen.material.MaterialRuleContext$LazyYCondition.test()                                                                87   2.43%
net.minecraft.world.level.levelgen.Aquifer$NoiseBasedAquifer.aquiferExtracted$refreshDistPosIdx(int, int, int)                                       84   2.35%
net.minecraft.world.level.levelgen.material.MaterialSystem.buildSurface(...)                                                                         72   2.01%
```

</details>

<details><summary>Hot methods: <code>lithium-ferrite-moonrise</code> (run 1)</summary>

```
                                                               Java Methods that Execute the Most
Method                                                                                                                                          Samples Percent
----------------------------------------------------------------------------------------------------------------------------------------------- ------- -------
net.minecraft.world.level.levelgen.synth.GradientNoise.permute(int)                                                                                 560  15.05%
net.minecraft.world.level.levelgen.Aquifer$NoiseBasedAquifer.computeSubstance(int, int, int, double)                                                223   5.99%
net.minecraft.world.level.levelgen.material.rule.SequenceRule.lambda$compile$0(RuleEvaluator[], int, int, int)                                      186   5.00%
net.minecraft.world.level.levelgen.material.rule.ConditionRule.lambda$compile$0(ConditionEvaluator, RuleEvaluator, int, int, int)                   153   4.11%
net.minecraft.world.level.chunk.PalettedContainer.readPalette(PalettedContainer$Data, int)                                                          147   3.95%
net.minecraft.world.level.chunk.LinearPalette.idFor(Object, PaletteResize)                                                                          115   3.09%
net.minecraft.world.level.biome.Climate$RTree$SubTree.search(long[], Climate$RTree$Leaf, Climate$DistanceMetric)                                    109   2.93%
net.minecraft.world.level.levelgen.NoiseBasedChunkGenerator.doFill(NoiseChunk, ChunkAccess)                                                         100   2.69%
net.minecraft.world.level.levelgen.densityfunction.DensityVolume.indexOfBlock(int, int, int)                                                         95   2.55%
net.minecraft.world.level.levelgen.material.MaterialRuleContext$LazyYCondition.test()                                                                93   2.50%
net.minecraft.world.level.levelgen.densityfunction.op.InterpolatedFunction$Sampler.fillCell(...)                                                     81   2.18%
ca.spottedleaf.moonrise.libs.ca.spottedleaf.concurrentutil.map.concurrent.longs.ConcurrentChainedLong2ReferenceHashTable.getNode(long)               77   2.07%
```

</details>
