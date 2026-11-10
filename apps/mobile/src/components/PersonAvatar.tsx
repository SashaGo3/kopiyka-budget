import { StyleSheet, Text, View } from "react-native";

/** The colours a friend can be drawn in: the system palette, so each reads in light and dark alike. */
const PALETTE = ["#FF9500", "#34C759", "#007AFF", "#AF52DE", "#FF2D55", "#5AC8FA", "#FFCC00", "#30B0C7", "#A2845E", "#5856D6"];

/** A friend's colour: the one they were given, else one picked from their id so it never changes. */
export function personColor(p: { id: string; color?: string | null }): string {
  if (p.color) return p.color;
  let h = 0;
  for (let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}

/** Up to two letters: the first of the first two words ("Ola Kowalska" → "OK"), else the first two of one. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length > 1 ? [words[0]!, words[1]!].map((w) => [...w][0]) : [...words[0]!].slice(0, 2);
  return letters.join("").toLocaleUpperCase();
}

/** A friend as a round tile with their initials — the category icon's place on a row. */
export function PersonAvatar({ person, size = 30 }: { person: { id: string; name: string; color?: string | null }; size?: number }) {
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: size / 2, backgroundColor: personColor(person) }]} accessible={false}>
      <Text style={[styles.text, { fontSize: size * 0.4 }]} allowFontScaling={false}>{initials(person.name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center" },
  text: { color: "white", fontWeight: "700" },
});
