package net.mb.minescripthud.mixin;

import net.mb.minescripthud.MinescriptHUDAddon;
import net.minescript.common.Job;
import net.minescript.common.SystemMessageQueue;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

// Minescript 4.0 has no Job.SubprocessJob; the "done" message is logged from Job.runOnJobThread.
@Mixin(value = Job.class, remap = false)
public class JobMixin {
	@Redirect(method="runOnJobThread",at=@At(value="INVOKE",target="Lnet/minescript/common/SystemMessageQueue;logUserInfo(Ljava/lang/String;[Ljava/lang/Object;)V"))
	private void runOnJobThread(SystemMessageQueue cls, String message, Object[] args) {
		if (!MinescriptHUDAddon.silent) {
			cls.logUserInfo(message,args);
		} else {
			MinescriptHUDAddon.silent=false;
		}
	}
}
