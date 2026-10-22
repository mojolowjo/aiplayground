package net.mb.minescripthud.util;

import com.google.gson.Gson;
import com.google.gson.JsonElement;

// Stands in for Minescript 5's Jsonable: public fields are serialized with Gson.
public abstract class Jsonable {
	private static final Gson GSON = new Gson();

	public JsonElement toJson() {
		return GSON.toJsonTree(this);
	}
}
