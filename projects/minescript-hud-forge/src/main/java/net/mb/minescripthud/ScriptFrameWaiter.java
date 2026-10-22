package net.mb.minescripthud;

import com.google.gson.JsonPrimitive;
import net.minescript.common.Job;

import java.util.ArrayList;
import java.util.List;

public class ScriptFrameWaiter {
	private static final ScriptFrameWaiter INSTANCE = new ScriptFrameWaiter();
	private record Waiter(Job job,long funcCallId) {}
	private final List<Waiter> waitingScripts=new ArrayList<>();

	public static ScriptFrameWaiter getInstance() {
		return INSTANCE;
	}

	public void waitNextFrame(Job job,long funcCallId) {
		waitingScripts.add(new Waiter(job,funcCallId));
	}

	public void onEndFrame() {
		for (Waiter w:waitingScripts) {
			w.job().respond(w.funcCallId(),new JsonPrimitive(true),true);
		}
		waitingScripts.clear();
	}
}
