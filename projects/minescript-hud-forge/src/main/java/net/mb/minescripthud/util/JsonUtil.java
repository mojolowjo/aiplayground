package net.mb.minescripthud.util;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonPrimitive;

// Stands in for Minescript 5's ScriptValue.of(...), which Minescript 4.0 does not have.
public final class JsonUtil {
	private JsonUtil() {}

	public static JsonElement toJson(Object value) {
		if (value == null) {
			return JsonNull.INSTANCE;
		} else if (value instanceof JsonElement e) {
			return e;
		} else if (value instanceof Jsonable j) {
			return j.toJson();
		} else if (value instanceof Boolean b) {
			return new JsonPrimitive(b);
		} else if (value instanceof Number n) {
			return new JsonPrimitive(n);
		} else if (value instanceof String s) {
			return new JsonPrimitive(s);
		} else if (value instanceof Object[] array) {
			JsonArray out = new JsonArray();
			for (Object o : array) {
				out.add(toJson(o));
			}
			return out;
		}
		throw new IllegalArgumentException("Cannot convert to JSON: " + value.getClass());
	}
}
